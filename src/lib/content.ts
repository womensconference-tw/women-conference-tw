import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { trimBlank, UUID_PATTERN } from "./registration";

/*
 * 後台編輯目前年度的內容（日期、時間、主題經文、歡迎詞、管理員 LINE）、時程時間點、常見問題與自訂區塊（#21）。
 * 只有總管理員能寫入，由資料庫的權限規則強制（ADR 0004）；這裡先確認一次，好在畫面上說明。
 * 時程的先後順序、報名開放後不能改開放時間，都由資料庫擋下，這裡把錯誤轉成代碼。
 * 首頁每次都向資料庫讀內容，存檔後立即反映。
 */

export type ContentError =
  | "not_admin"
  | "date_invalid"
  | "time_invalid"
  | "line_id_invalid"
  | "schedule_invalid"
  | "schedule_incomplete"
  | "schedule_order"
  | "opens_at_locked"
  | "title_required"
  | "body_required"
  | "button_label_required"
  | "button_url_invalid"
  | "not_found"
  | "unavailable";

export type ContentResult = { ok: true } | { ok: false; error: ContentError };

/** 中文有填、英文沒填（前台英文版會顯示中文）時，後台要警示。 */
export function missingEnglish(zh: string, en: string): boolean {
  return trimBlank(zh) !== "" && trimBlank(en) === "";
}

// 台灣沒有日光節約時間，一律 +08:00。
const TAIPEI_OFFSET = "+08:00";
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 表單上的台灣時間（datetime-local，例如 2027-03-01T09:00）換成資料庫的時間。空白是 null，看不懂的是 undefined。 */
export function parseTaipeiDateTime(raw: string): string | null | undefined {
  const value = trimBlank(raw);
  if (value === "") return null;
  // 瀏覽器通常只送到分鐘，有些會帶秒數。
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:[0-5]\d)?$/.exec(value);
  if (!match || !validDate(match[1]) || !validTime(match[2])) return undefined;
  return new Date(`${match[1]}T${match[2]}${match[3] ?? ":00"}${TAIPEI_OFFSET}`).toISOString();
}

/** 資料庫的時間換成表單上的台灣時間（到分鐘）。 */
export function toTaipeiDateTimeInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 16);
}

/** YYYY-MM-DD，而且是真的有的日子（沒有 2 月 30 日）。 */
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// HH:MM，00:00–23:59。
function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * 自訂區塊按鈕的網址，和資料庫 custom_blocks_button_url_safe 一致：有網域的 http(s) 網址或站內路徑，
 * 站內路徑的第二個字不能是 / 或 \，整個網址不能有空白或控制字元（瀏覽器會當成連到別的網站）。
 * 不能有的字元明確列出，和資料庫一字不差：U+0001–0020、U+007F–00A0、以及其他 Unicode 空白（含 U+FEFF）。
 */
export function isSafeButtonUrl(url: string): boolean {
  return (
    /^(https?:\/\/[^/\\?#]+|\/([^/\\]|$))/i.test(url) &&
    !/[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(url)
  );
}

// LINE ID 只有英數字與 . - _，官方帳號以 @ 開頭。
const LINE_ID_PATTERN = /^@?[A-Za-z0-9._-]{1,40}$/;

export type ConferenceDetailsInput = {
  conferenceId: string;
  /** 大會當天，YYYY-MM-DD。 */
  conferenceDate: string;
  /** 開始與結束時間（台灣時間，HH:MM）；空白表示不顯示。 */
  startTime: string;
  endTime: string;
  themeScriptureZh: string;
  themeScriptureEn: string;
  themeScriptureReferenceZh: string;
  themeScriptureReferenceEn: string;
  welcomeZh: string;
  welcomeEn: string;
  /** 空白表示首頁「需要幫忙」不顯示 LINE。 */
  adminLineId: string;
};

/** 儲存年度大會的日期、時間、主題經文、歡迎詞與管理員 LINE。 */
export async function saveConferenceDetails(
  supabase: SupabaseClient,
  input: ConferenceDetailsInput,
): Promise<ContentResult> {
  const text = (value: string) => trimBlank(value);

  const conferenceDate = text(input.conferenceDate);
  if (!validDate(conferenceDate)) return { ok: false, error: "date_invalid" };
  const startTime = text(input.startTime);
  const endTime = text(input.endTime);
  if (
    (startTime && !validTime(startTime)) ||
    (endTime && !validTime(endTime)) ||
    (endTime && (!startTime || endTime <= startTime))
  ) {
    return { ok: false, error: "time_invalid" };
  }
  const adminLineId = text(input.adminLineId);
  if (adminLineId && !LINE_ID_PATTERN.test(adminLineId)) return { ok: false, error: "line_id_invalid" };

  return updateConference(supabase, input.conferenceId, {
    conference_date: conferenceDate,
    start_time: startTime || null,
    end_time: endTime || null,
    theme_scripture_zh: text(input.themeScriptureZh),
    theme_scripture_en: text(input.themeScriptureEn),
    theme_scripture_reference_zh: text(input.themeScriptureReferenceZh),
    theme_scripture_reference_en: text(input.themeScriptureReferenceEn),
    welcome_zh: text(input.welcomeZh),
    welcome_en: text(input.welcomeEn),
    admin_line_id: adminLineId || null,
  });
}

export type ScheduleInput = {
  conferenceId: string;
  /** 表單上的台灣時間（datetime-local）。 */
  announceAt: string;
  /** 報名開放後不能再改，表單不送這一欄，這裡也不改。 */
  registrationOpensAt?: string;
  registrationClosesAt: string;
};

/** 儲存公告上線、報名開放、報名截止三個時間點。首頁的狀態依這三個時間切換。 */
export async function saveSchedule(supabase: SupabaseClient, input: ScheduleInput): Promise<ContentResult> {
  const announceAt = parseTaipeiDateTime(input.announceAt);
  const closesAt = parseTaipeiDateTime(input.registrationClosesAt);
  const opensAt = input.registrationOpensAt === undefined ? undefined : parseTaipeiDateTime(input.registrationOpensAt);
  if (announceAt === undefined || closesAt === undefined || (input.registrationOpensAt !== undefined && opensAt === undefined)) {
    return { ok: false, error: "schedule_invalid" };
  }

  const current = await checkCurrentConference(supabase, input.conferenceId);
  if (!current.ok) return current;

  const values: Record<string, unknown> = { announce_at: announceAt, registration_closes_at: closesAt };
  // 表單只到分鐘。開放時間沒改時不寫回去，免得秒數不同被當成修改，報名開放後就存不了。
  if (
    opensAt !== undefined &&
    !(opensAt && toTaipeiDateTimeInput(current.registrationOpensAt) === toTaipeiDateTimeInput(opensAt))
  ) {
    values.registration_opens_at = opensAt;
  }
  return updateConference(supabase, input.conferenceId, values, true);
}

async function updateConference(
  supabase: SupabaseClient,
  conferenceId: string,
  values: Record<string, unknown>,
  checked = false,
): Promise<ContentResult> {
  if (!checked) {
    const current = await checkCurrentConference(supabase, conferenceId);
    if (!current.ok) return current;
  }

  const { data, error } = await supabase
    .from("conferences")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", conferenceId)
    .eq("is_current", true)
    .select("id");
  if (error) return failure(error);
  return data.length === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/**
 * 確認是總管理員、表單上的年度還是目前年度。頁面開著時目前年度換了，送出的就是舊年度；
 * 不擋的話會改到前台看不到的年度，畫面卻說首頁已經更新。
 */
async function checkCurrentConference(
  supabase: SupabaseClient,
  conferenceId: string,
): Promise<{ ok: true; registrationOpensAt: string | null } | { ok: false; error: ContentError }> {
  if (!validIds(conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = await supabase
    .from("conferences")
    .select("registration_opens_at")
    .eq("id", conferenceId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) return failure(error);
  return data ? { ok: true, registrationOpensAt: data.registration_opens_at } : { ok: false, error: "not_found" };
}

/** 可以新增、修改、排序、刪除的首頁項目：常見問題、自訂區塊。 */
export const HOME_ITEM_KINDS = ["faq", "block"] as const;
export type HomeItemKind = (typeof HOME_ITEM_KINDS)[number];

/** 每種項目存在哪張表、標題與內文欄位叫什麼。常見問題的標題是問題、內文是答案。 */
const HOME_ITEMS: Record<HomeItemKind, { table: string; title: string; body: string }> = {
  faq: { table: "faqs", title: "question", body: "answer" },
  block: { table: "custom_blocks", title: "title", body: "body" },
};

/** 新增或修改一個常見問題或自訂區塊時填的欄位，都是表單上的原始文字。按鈕只有自訂區塊有。 */
export type HomeItemInput = {
  kind: HomeItemKind;
  /** 有就是修改，沒有就是新增（排在最後）。 */
  id?: string | null;
  conferenceId: string;
  titleZh: string;
  titleEn?: string;
  bodyZh?: string;
  bodyEn?: string;
  buttonLabelZh?: string;
  buttonLabelEn?: string;
  /** 空白表示沒有按鈕。 */
  buttonUrl?: string;
};

/** 新增或修改一個常見問題或自訂區塊。 */
export async function saveHomeItem(
  supabase: SupabaseClient,
  input: HomeItemInput,
): Promise<{ ok: true; id: string } | { ok: false; error: ContentError }> {
  const item = HOME_ITEMS[input.kind];
  const text = (value: string | undefined) => trimBlank(value ?? "");

  const titleZh = text(input.titleZh);
  if (!titleZh) return { ok: false, error: "title_required" };
  const bodyZh = text(input.bodyZh);
  if (input.kind === "faq" && !bodyZh) return { ok: false, error: "body_required" };

  const values: Record<string, unknown> = {
    [`${item.title}_zh`]: titleZh,
    [`${item.title}_en`]: text(input.titleEn),
    [`${item.body}_zh`]: bodyZh,
    [`${item.body}_en`]: text(input.bodyEn),
  };
  if (input.kind === "block") {
    const buttonUrl = text(input.buttonUrl);
    const buttonLabelZh = text(input.buttonLabelZh);
    if (buttonUrl && !isSafeButtonUrl(buttonUrl)) return { ok: false, error: "button_url_invalid" };
    if (buttonUrl && !buttonLabelZh) return { ok: false, error: "button_label_required" };
    Object.assign(values, {
      button_url: buttonUrl || null,
      button_label_zh: buttonLabelZh,
      button_label_en: text(input.buttonLabelEn),
    });
  }

  if (!validIds(input.id, input.conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  // 確認是目前年度與寫入在同一個交易裡（save_home_item），中間年度不會被換掉。新的排在最後。
  const { data, error } = await supabase.rpc("save_home_item", {
    p_table: item.table,
    p_id: input.id || null,
    p_conference_id: input.conferenceId,
    p_values: values,
  });
  return error ? failure(error) : { ok: true, id: data as string };
}

/** 刪除一個常見問題或自訂區塊。只能刪目前年度的。 */
export async function deleteHomeItem(supabase: SupabaseClient, kind: HomeItemKind, id: string): Promise<ContentResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  // 只刪目前年度的（delete_home_item）。
  const { error } = await supabase.rpc("delete_home_item", { p_table: HOME_ITEMS[kind].table, p_id: id });
  return error ? failure(error) : { ok: true };
}

/** 把一個常見問題或自訂區塊往前或往後移一格；已經在最前或最後時不動。只能移目前年度的。 */
export async function moveHomeItem(
  supabase: SupabaseClient,
  kind: HomeItemKind,
  id: string,
  direction: "up" | "down",
): Promise<ContentResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("move_home_item", {
    p_table: HOME_ITEMS[kind].table,
    p_id: id,
    p_up: direction === "up",
  });
  return error ? failure(error) : { ok: true };
}

// 表單送來的編號格式不對（網頁被改過、或是很舊的頁面），當成找不到，不必交給資料庫。空的不算。
function validIds(...ids: (string | null | undefined)[]): boolean {
  return ids.every((id) => !id || UUID_PATTERN.test(id));
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下（修改、刪除時只是找不到資料），先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: ContentError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: ContentError } {
  const violates = (constraint: string) => error.code === "23514" && error.message.includes(constraint);
  switch (true) {
    case error.message === "registration_opens_at_locked":
      return { ok: false, error: "opens_at_locked" };
    case violates("conferences_current_schedule_complete"):
      return { ok: false, error: "schedule_incomplete" };
    case violates("conferences_announce_before_opens"):
    case violates("conferences_opens_before_closes"):
    case violates("conferences_announce_before_closes"):
      return { ok: false, error: "schedule_order" };
    case violates("custom_blocks_button_url_safe"):
      return { ok: false, error: "button_url_invalid" };
    case violates("custom_blocks_button_has_label"):
      return { ok: false, error: "button_label_required" };
    case violates("custom_blocks_title_not_blank"):
      return { ok: false, error: "title_required" };
    // 問題或答案只有空白：表單上兩個都標了必填，用同一句說明。
    case violates("faqs_not_blank"):
      return { ok: false, error: "body_required" };
    case violates("conferences_start_before_end"):
    case violates("conferences_end_needs_start"):
      return { ok: false, error: "time_invalid" };
    case error.message === "not_found":
      return { ok: false, error: "not_found" };
    case error.message === "not_admin":
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("編輯首頁內容失敗", error);
  return { ok: false, error: "unavailable" };
}

/** 後台編輯用的一個常見問題或自訂區塊，中英兩欄都在。常見問題沒有按鈕，按鈕欄位是空的。 */
export type HomeItem = {
  id: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  buttonLabelZh: string;
  buttonLabelEn: string;
  buttonUrl: string;
};

export type ContentEditor = {
  conferenceId: string;
  year: number;
  conferenceDate: string;
  /** HH:MM；沒填是空字串。 */
  startTime: string;
  endTime: string;
  themeScriptureZh: string;
  themeScriptureEn: string;
  themeScriptureReferenceZh: string;
  themeScriptureReferenceEn: string;
  welcomeZh: string;
  welcomeEn: string;
  adminLineId: string;
  /** 三個時間點，資料庫的時間；沒填是 null。 */
  announceAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** 報名已開放：開放時間不能再改。 */
  registrationOpened: boolean;
  faqs: HomeItem[];
  customBlocks: HomeItem[];
};

/** 目前年度的內容，含中英兩欄、時程、常見問題與自訂區塊（依首頁的順序）。沒有目前年度時回傳 null。 */
export async function getContentEditor(supabase: SupabaseClient): Promise<ContentEditor | null> {
  const { data, error } = await supabase
    .from("conferences")
    .select(
      `id, year, conference_date, start_time, end_time, admin_line_id,
      announce_at, registration_opens_at, registration_closes_at,
      theme_scripture_zh, theme_scripture_en, theme_scripture_reference_zh, theme_scripture_reference_en,
      welcome_zh, welcome_en,
      faqs(id, question_zh, question_en, answer_zh, answer_en),
      custom_blocks(id, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url)`,
    )
    .eq("is_current", true)
    .order("position", { referencedTable: "faqs" })
    .order("id", { referencedTable: "faqs" })
    .order("position", { referencedTable: "custom_blocks" })
    .order("id", { referencedTable: "custom_blocks" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const opensAt = data.registration_opens_at;
  return {
    conferenceId: data.id,
    year: data.year,
    conferenceDate: data.conference_date,
    // 資料庫的 time 欄位讀出來是 "09:00:00"。
    startTime: data.start_time?.slice(0, 5) ?? "",
    endTime: data.end_time?.slice(0, 5) ?? "",
    themeScriptureZh: data.theme_scripture_zh,
    themeScriptureEn: data.theme_scripture_en,
    themeScriptureReferenceZh: data.theme_scripture_reference_zh,
    themeScriptureReferenceEn: data.theme_scripture_reference_en,
    welcomeZh: data.welcome_zh,
    welcomeEn: data.welcome_en,
    adminLineId: data.admin_line_id ?? "",
    announceAt: data.announce_at,
    registrationOpensAt: opensAt,
    registrationClosesAt: data.registration_closes_at,
    registrationOpened: opensAt !== null && new Date(opensAt) <= new Date(),
    faqs: data.faqs.map((faq) => ({
      id: faq.id,
      titleZh: faq.question_zh,
      titleEn: faq.question_en,
      bodyZh: faq.answer_zh,
      bodyEn: faq.answer_en,
      buttonLabelZh: "",
      buttonLabelEn: "",
      buttonUrl: "",
    })),
    customBlocks: data.custom_blocks.map((block) => ({
      id: block.id,
      titleZh: block.title_zh,
      titleEn: block.title_en,
      bodyZh: block.body_zh,
      bodyEn: block.body_en,
      buttonLabelZh: block.button_label_zh,
      buttonLabelEn: block.button_label_en,
      buttonUrl: block.button_url ?? "",
    })),
  };
}
