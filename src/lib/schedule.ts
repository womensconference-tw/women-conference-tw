import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { trimBlank, UUID_PATTERN } from "./registration";

/*
 * 後台「大會時程」：目前年度的大會日期、開始與結束時間，以及公告上線、報名開放、報名截止三個時間點。
 * 只有總管理員能寫入，由資料庫的權限規則強制（ADR 0004）；這裡先確認一次，好在畫面上說明。
 * 時程的先後順序、報名開放後不能改開放時間，都由資料庫擋下，這裡把錯誤轉成代碼。
 * 報名入口頁每次都向資料庫讀，存檔後立即反映。
 */

export type ScheduleError =
  | "not_admin"
  | "date_invalid"
  | "time_invalid"
  | "schedule_invalid"
  | "schedule_incomplete"
  | "schedule_order"
  | "opens_at_locked"
  | "not_found"
  | "unavailable";

export type ScheduleResult = { ok: true } | { ok: false; error: ScheduleError };

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

export type ConferenceDetailsInput = {
  conferenceId: string;
  /** 大會當天，YYYY-MM-DD。 */
  conferenceDate: string;
  /** 開始與結束時間（台灣時間，HH:MM）；空白表示報名入口頁不顯示時間。 */
  startTime: string;
  endTime: string;
};

/** 儲存年度大會的日期與開始、結束時間。主題經文、歡迎詞等舊首頁的欄位不動（資料留著，ADR 0012）。 */
export async function saveConferenceDetails(
  supabase: SupabaseClient,
  input: ConferenceDetailsInput,
): Promise<ScheduleResult> {
  const conferenceDate = trimBlank(input.conferenceDate);
  if (!validDate(conferenceDate)) return { ok: false, error: "date_invalid" };
  const startTime = trimBlank(input.startTime);
  const endTime = trimBlank(input.endTime);
  if (
    (startTime && !validTime(startTime)) ||
    (endTime && !validTime(endTime)) ||
    (endTime && (!startTime || endTime <= startTime))
  ) {
    return { ok: false, error: "time_invalid" };
  }

  return updateConference(supabase, input.conferenceId, {
    conference_date: conferenceDate,
    start_time: startTime || null,
    end_time: endTime || null,
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

/** 儲存公告上線、報名開放、報名截止三個時間點。報名入口頁的報名狀態依這三個時間切換。 */
export async function saveSchedule(supabase: SupabaseClient, input: ScheduleInput): Promise<ScheduleResult> {
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
): Promise<ScheduleResult> {
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
 * 不擋的話會改到前台看不到的年度，畫面卻說已經更新。
 */
async function checkCurrentConference(
  supabase: SupabaseClient,
  conferenceId: string,
): Promise<{ ok: true; registrationOpensAt: string | null } | { ok: false; error: ScheduleError }> {
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

// 表單送來的編號格式不對（網頁被改過、或是很舊的頁面），當成找不到，不必交給資料庫。空的不算。
function validIds(...ids: (string | null | undefined)[]): boolean {
  return ids.every((id) => !id || UUID_PATTERN.test(id));
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下（修改、刪除時只是找不到資料），先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: ScheduleError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: ScheduleError } {
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
    case violates("conferences_start_before_end"):
    case violates("conferences_end_needs_start"):
      return { ok: false, error: "time_invalid" };
    case error.message === "not_found":
      return { ok: false, error: "not_found" };
    case error.message === "not_admin":
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("編輯大會時程失敗", error);
  return { ok: false, error: "unavailable" };
}

/** 後台「大會時程」頁要的目前年度資料。 */
export type ScheduleEditor = {
  conferenceId: string;
  year: number;
  conferenceDate: string;
  /** HH:MM；沒填是空字串。 */
  startTime: string;
  endTime: string;
  /** 三個時間點，資料庫的時間；沒填是 null。 */
  announceAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** 報名已開放：開放時間不能再改。 */
  registrationOpened: boolean;
};

/** 讀目前年度的日期、時間與時程。沒有目前年度時回傳 null。 */
export async function getScheduleEditor(supabase: SupabaseClient): Promise<ScheduleEditor | null> {
  const { data, error } = await supabase
    .from("conferences")
    .select("id, year, conference_date, start_time, end_time, announce_at, registration_opens_at, registration_closes_at")
    .eq("is_current", true)
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
    announceAt: data.announce_at,
    registrationOpensAt: opensAt,
    registrationClosesAt: data.registration_closes_at,
    registrationOpened: opensAt !== null && new Date(opensAt) <= new Date(),
  };
}
