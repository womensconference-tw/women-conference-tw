import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { parseTaipeiDateTime, validDate } from "./content";
import { trimBlank, UUID_PATTERN } from "./registration";

/*
 * 年度管理（#25）：複製去年建立新年度、切換目前年度、後台選年度檢視舊年度。
 * 複製與切換只有總管理員能做，由資料庫函式檢查（copy_conference、set_current_conference）；這裡先擋一次格式。
 */

export type YearError =
  | "not_admin"
  | "year_invalid"
  | "year_taken"
  | "date_invalid"
  | "date_not_in_year"
  | "schedule_invalid"
  | "schedule_incomplete"
  | "schedule_order"
  | "not_found"
  | "unavailable";

/** 後台年度選單與年度管理頁的一個年度。 */
export type ConferenceYear = {
  id: string;
  year: number;
  /** 大會當天，YYYY-MM-DD。 */
  conferenceDate: string;
  isCurrent: boolean;
  /** 三個時程時間點，資料庫的時間；沒填是 null（複製出來的新年度）。 */
  announceAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
};

/** 所有年度，新的在前。只有工作人員讀得到全部；前台訪客只讀得到目前年度。 */
export async function listConferences(supabase: SupabaseClient): Promise<ConferenceYear[]> {
  const { data, error } = await supabase
    .from("conferences")
    .select("id, year, conference_date, is_current, announce_at, registration_opens_at, registration_closes_at")
    .order("year", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    year: row.year,
    conferenceDate: row.conference_date,
    isCurrent: row.is_current,
    announceAt: row.announce_at,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
  }));
}

export type CopyConferenceInput = {
  /** 要複製的年度（通常是去年）。 */
  sourceConferenceId: string;
  /** 表單上的原始文字。 */
  year: string;
  /** 新年度的大會日期，YYYY-MM-DD。 */
  conferenceDate: string;
};

/** 複製一個年度建立新年度。報名不複製，時程時間點空著待填，也不會變成目前年度。 */
export async function copyConference(
  supabase: SupabaseClient,
  input: CopyConferenceInput,
): Promise<{ ok: true; conferenceId: string } | { ok: false; error: YearError }> {
  const year = Number(trimBlank(input.year));
  if (!/^\d{4}$/.test(trimBlank(input.year)) || year < 2000) return { ok: false, error: "year_invalid" };
  const conferenceDate = trimBlank(input.conferenceDate);
  if (!validDate(conferenceDate)) return { ok: false, error: "date_invalid" };
  // 日期選單預設是來源年度的明年，改了年度卻忘了改日期時擋下。
  if (!conferenceDate.startsWith(`${year}-`)) return { ok: false, error: "date_not_in_year" };
  if (!UUID_PATTERN.test(input.sourceConferenceId)) return { ok: false, error: "not_found" };

  const { data, error } = await supabase.rpc("copy_conference", {
    p_source_id: input.sourceConferenceId,
    p_year: year,
    p_conference_date: conferenceDate,
  });
  return error ? failure(error) : { ok: true, conferenceId: data as string };
}

export type SetCurrentConferenceInput = {
  conferenceId: string;
  /**
   * 表單上的台灣時間（datetime-local）。只用來補上這個年度還空著的時間點（複製出來的新年度），
   * 已經填了的不會被改；時程已填好的年度不必給。
   */
  announceAt?: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
};

/**
 * 把一個年度設為目前年度，前台立即改顯示這個年度；原本的目前年度變成舊年度，資料都保留。
 * 目前年度的三個時程時間點都要有，空著的要一起填。
 */
export async function setCurrentConference(
  supabase: SupabaseClient,
  input: SetCurrentConferenceInput,
): Promise<{ ok: true } | { ok: false; error: YearError }> {
  const times = [input.announceAt, input.registrationOpensAt, input.registrationClosesAt].map((raw) =>
    parseTaipeiDateTime(raw ?? ""),
  );
  if (times.includes(undefined)) return { ok: false, error: "schedule_invalid" };
  if (!UUID_PATTERN.test(input.conferenceId)) return { ok: false, error: "not_found" };

  const [announceAt, opensAt, closesAt] = times;
  const { error } = await supabase.rpc("set_current_conference", {
    p_conference_id: input.conferenceId,
    p_announce_at: announceAt,
    p_registration_opens_at: opensAt,
    p_registration_closes_at: closesAt,
  });
  return error ? failure(error) : { ok: true };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: YearError } {
  const violates = (constraint: string) => error.code === "23514" && error.message.includes(constraint);
  switch (true) {
    case violates("conferences_current_schedule_complete"):
      return { ok: false, error: "schedule_incomplete" };
    case violates("conferences_announce_before_opens"):
    case violates("conferences_opens_before_closes"):
    case violates("conferences_announce_before_closes"):
      return { ok: false, error: "schedule_order" };
    case error.code === "23505" && error.message.includes("conferences_year_key"):
      return { ok: false, error: "year_taken" };
    case error.message === "not_found":
      return { ok: false, error: "not_found" };
    case error.message === "not_admin":
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("年度管理失敗", error);
  return { ok: false, error: "unavailable" };
}
