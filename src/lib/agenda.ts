import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { trimBlank, UUID_PATTERN } from "./registration";

/*
 * 後台編輯目前年度的大會程序（#84）：一整天的時間軸，每一列各場地共用時間、名稱、子項目，
 * 地點、補充說明、對應的場次各場地不同。首頁的「大會程序」照這裡顯示（#85）。
 * 只有總管理員能寫入，由資料庫的權限規則強制（ADR 0004）；這裡先確認一次，好在畫面上說明。
 * 一個場次只能接到一列、場次要是同一間教堂的，都由資料庫擋下，這裡把錯誤轉成代碼。
 */

export type AgendaError =
  | "not_admin"
  | "name_required"
  | "time_invalid"
  | "part_name_required"
  | "highlight_invalid"
  | "session_taken"
  | "session_invalid"
  | "not_found"
  | "unavailable";

export type AgendaResult = { ok: true } | { ok: false; error: AgendaError };

/** 一個子項目，都是表單上的原始文字。highlightId 空白表示不連到大會特色。 */
export type AgendaPartInput = { nameZh: string; nameEn: string; highlightId: string };

export type AgendaItemInput = {
  /** 有就是修改，沒有就是新增（排在最後）。 */
  id?: string | null;
  conferenceId: string;
  /** HH:MM，台灣時間。 */
  startTime: string;
  endTime: string;
  nameZh: string;
  nameEn: string;
  /** 依顯示順序。中英都空白的列（表單上沒填的空格）略過。 */
  parts: AgendaPartInput[];
};

// HH:MM，00:00–23:59；瀏覽器有時會帶秒數。
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** 新增或修改一列，子項目整批換成這次送來的。 */
export async function saveAgendaItem(
  supabase: SupabaseClient,
  input: AgendaItemInput,
): Promise<{ ok: true; id: string } | { ok: false; error: AgendaError }> {
  const text = (value: string) => trimBlank(value);

  const nameZh = text(input.nameZh);
  if (!nameZh) return { ok: false, error: "name_required" };
  const startTime = text(input.startTime).slice(0, 5);
  const endTime = text(input.endTime).slice(0, 5);
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime) || endTime <= startTime) {
    return { ok: false, error: "time_invalid" };
  }
  const parts = input.parts
    .map((part) => ({ nameZh: text(part.nameZh), nameEn: text(part.nameEn), highlightId: text(part.highlightId) }))
    .filter((part) => part.nameZh || part.nameEn);
  if (parts.some((part) => !part.nameZh)) return { ok: false, error: "part_name_required" };
  if (!parts.every((part) => !part.highlightId || UUID_PATTERN.test(part.highlightId))) {
    return { ok: false, error: "highlight_invalid" };
  }

  if (!validIds(input.id, input.conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  // 確認是目前年度、這一列與子項目在同一個交易裡寫入（save_agenda_item）。
  const { data, error } = await supabase.rpc("save_agenda_item", {
    p_id: input.id || null,
    p_conference_id: input.conferenceId,
    p_start_time: startTime,
    p_end_time: endTime,
    p_name_zh: nameZh,
    p_name_en: text(input.nameEn),
    p_parts: parts.map((part) => ({
      name_zh: part.nameZh,
      name_en: part.nameEn,
      highlight_id: part.highlightId || null,
    })),
  });
  return error ? failure(error) : { ok: true, id: data as string };
}

export type AgendaVenueInput = {
  agendaItemId: string;
  venueId: string;
  placeZh: string;
  placeEn: string;
  noteZh: string;
  noteEn: string;
  /** 空白表示這一列在這個場地沒有對應的場次。 */
  sessionId: string;
};

/** 存一列在一個場地的地點、補充說明、對應場次。 */
export async function saveAgendaVenue(supabase: SupabaseClient, input: AgendaVenueInput): Promise<AgendaResult> {
  const text = (value: string) => trimBlank(value);
  if (!validIds(input.agendaItemId, input.venueId) || !input.agendaItemId || !input.venueId) {
    return { ok: false, error: "not_found" };
  }
  if (!validIds(input.sessionId)) return { ok: false, error: "session_invalid" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("save_agenda_item_venue", {
    p_agenda_item_id: input.agendaItemId,
    p_venue_id: input.venueId,
    p_place_zh: text(input.placeZh),
    p_place_en: text(input.placeEn),
    p_note_zh: text(input.noteZh),
    p_note_en: text(input.noteEn),
    p_session_id: input.sessionId || null,
  });
  return error ? failure(error) : { ok: true };
}

/** 把一列往前或往後移一格；已經在最前或最後時不動。只能移目前年度的。 */
export async function moveAgendaItem(
  supabase: SupabaseClient,
  id: string,
  direction: "up" | "down",
): Promise<AgendaResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("move_home_item", { p_table: "agenda_items", p_id: id, p_up: direction === "up" });
  return error ? failure(error) : { ok: true };
}

/** 刪除一列，連同子項目與各場地的設定。只能刪目前年度的。 */
export async function deleteAgendaItem(supabase: SupabaseClient, id: string): Promise<AgendaResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("delete_home_item", { p_table: "agenda_items", p_id: id });
  return error ? failure(error) : { ok: true };
}

// 表單送來的編號格式不對（網頁被改過、或是很舊的頁面），當成找不到，不必交給資料庫。空的不算。
function validIds(...ids: (string | null | undefined)[]): boolean {
  return ids.every((id) => !id || UUID_PATTERN.test(id));
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下，先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: AgendaError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: AgendaError } {
  const violates = (constraint: string) => error.message.includes(constraint);
  switch (true) {
    case error.code === "23505" && violates("agenda_item_venues_session_once"):
      return { ok: false, error: "session_taken" };
    case error.code === "23503" && violates("agenda_item_venues_session_same_venue"):
      return { ok: false, error: "session_invalid" };
    case error.code === "23503" && violates("agenda_item_parts_highlight_same_conference"):
      return { ok: false, error: "highlight_invalid" };
    // 場地不是這一列同一年度的（網頁被改過、或場地剛被刪掉）。
    case error.code === "23503" && violates("agenda_item_venues_venue"):
      return { ok: false, error: "not_found" };
    case error.code === "23514" && violates("agenda_items_start_before_end"):
      return { ok: false, error: "time_invalid" };
    case error.code === "23514" && violates("agenda_items_name_not_blank"):
      return { ok: false, error: "name_required" };
    case error.code === "23514" && violates("agenda_item_parts_name_not_blank"):
      return { ok: false, error: "part_name_required" };
    case error.message === "not_found":
      return { ok: false, error: "not_found" };
    case error.message === "not_admin":
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("編輯大會程序失敗", error);
  return { ok: false, error: "unavailable" };
}

export type AgendaPart = { nameZh: string; nameEn: string; highlightId: string | null };

/** 一列在一個場地的設定；還沒設定時都是空的。 */
export type AgendaVenueSetting = {
  placeZh: string;
  placeEn: string;
  noteZh: string;
  noteEn: string;
  sessionId: string | null;
};

export type AgendaItem = {
  id: string;
  /** HH:MM。 */
  startTime: string;
  endTime: string;
  nameZh: string;
  nameEn: string;
  parts: AgendaPart[];
  /** 依場地編號。 */
  venues: Record<string, AgendaVenueSetting>;
};

export type AgendaEditor = {
  conferenceId: string;
  year: number;
  items: AgendaItem[];
  /** 場地與它的場次，依排序。 */
  venues: { id: string; nameZh: string; sessions: { id: string; nameZh: string }[] }[];
  /** 子項目可以連的大會特色，依首頁的順序。 */
  highlights: { id: string; nameZh: string }[];
  /** 還沒接到任何一列的場次（首頁會漏掉這些課程）。 */
  unplacedSessions: { venueNameZh: string; sessionNameZh: string }[];
};

const EMPTY_SETTING: AgendaVenueSetting = { placeZh: "", placeEn: "", noteZh: "", noteEn: "", sessionId: null };

/** 目前年度的大會程序，含中英兩欄與各場地的設定。沒有目前年度時回傳 null。 */
export async function getAgendaEditor(supabase: SupabaseClient): Promise<AgendaEditor | null> {
  const { data, error } = await supabase
    .from("conferences")
    .select(
      `id, year,
      agenda_items(id, start_time, end_time, name_zh, name_en,
        agenda_item_parts(position, name_zh, name_en, highlight_id),
        agenda_item_venues(venue_id, place_zh, place_en, note_zh, note_en, session_id)),
      venues(id, name_zh, sessions(id, name_zh)),
      highlights(id, name_zh)`,
    )
    .eq("is_current", true)
    // 排序相同時再依 id，讓順序每次都一樣（和首頁一樣）。
    .order("position", { referencedTable: "agenda_items" })
    .order("id", { referencedTable: "agenda_items" })
    .order("position", { referencedTable: "agenda_items.agenda_item_parts" })
    .order("id", { referencedTable: "agenda_items.agenda_item_parts" })
    .order("position", { referencedTable: "venues" })
    .order("id", { referencedTable: "venues" })
    .order("position", { referencedTable: "venues.sessions" })
    .order("id", { referencedTable: "venues.sessions" })
    .order("position", { referencedTable: "highlights" })
    .order("id", { referencedTable: "highlights" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const items: AgendaItem[] = data.agenda_items.map((item) => ({
    id: item.id,
    // 資料庫的 time 欄位讀出來是 "09:00:00"。
    startTime: item.start_time.slice(0, 5),
    endTime: item.end_time.slice(0, 5),
    nameZh: item.name_zh,
    nameEn: item.name_en,
    parts: item.agenda_item_parts.map((part) => ({
      nameZh: part.name_zh,
      nameEn: part.name_en,
      highlightId: part.highlight_id,
    })),
    venues: Object.fromEntries(
      data.venues.map((venue) => {
        const setting = item.agenda_item_venues.find((row) => row.venue_id === venue.id);
        return [
          venue.id,
          setting
            ? {
                placeZh: setting.place_zh,
                placeEn: setting.place_en,
                noteZh: setting.note_zh,
                noteEn: setting.note_en,
                sessionId: setting.session_id,
              }
            : EMPTY_SETTING,
        ];
      }),
    ),
  }));

  const placed = new Set(items.flatMap((item) => Object.values(item.venues).map((setting) => setting.sessionId)));
  return {
    conferenceId: data.id,
    year: data.year,
    items,
    venues: data.venues.map((venue) => ({
      id: venue.id,
      nameZh: venue.name_zh,
      sessions: venue.sessions.map((session) => ({ id: session.id, nameZh: session.name_zh })),
    })),
    highlights: data.highlights.map((highlight) => ({ id: highlight.id, nameZh: highlight.name_zh })),
    unplacedSessions: data.venues.flatMap((venue) =>
      venue.sessions
        .filter((session) => !placed.has(session.id))
        .map((session) => ({ venueNameZh: venue.name_zh, sessionNameZh: session.name_zh })),
    ),
  };
}
