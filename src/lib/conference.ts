import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 時程階段。首頁與報名服務都用這裡的判斷，不各自計算。
 * - unannounced：公告上線前
 * - upcoming：報名前（公告上線 ≤ 現在 < 報名開放）
 * - open：報名中（報名開放 ≤ 現在 < 報名截止）
 * - closed：已截止（報名截止 ≤ 現在）
 * 尚未填寫的時間點視為還沒到。
 */
export type SchedulePhase = "unannounced" | "upcoming" | "open" | "closed";

export type Schedule = {
  announceAt: Date | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
};

export type CurrentConference = Schedule & {
  year: number;
  /** 大會當天，格式 YYYY-MM-DD（台灣日期）。 */
  conferenceDate: string;
  phase: SchedulePhase;
};

/** 讀取目前年度，並依 `now` 判斷時程階段。沒有目前年度時回傳 null。 */
export async function getCurrentConference(
  supabase: SupabaseClient,
  now: Date,
): Promise<CurrentConference | null> {
  const { data, error } = await supabase
    .from("conferences")
    .select("year, conference_date, announce_at, registration_opens_at, registration_closes_at")
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const schedule: Schedule = {
    announceAt: toDate(data.announce_at),
    registrationOpensAt: toDate(data.registration_opens_at),
    registrationClosesAt: toDate(data.registration_closes_at),
  };
  return {
    year: data.year,
    conferenceDate: data.conference_date,
    ...schedule,
    phase: schedulePhase(schedule, now),
  };
}

/**
 * 首頁要照哪個階段顯示；null 表示只顯示「大會資訊即將公布」（還沒有目前年度，或公告上線前）。
 * 預覽時公告上線前也照報名前的樣子顯示完整內容，讓工作人員先看看；公告上線之後和前台一樣。
 */
export function homePhase(
  conference: CurrentConference | null,
  { preview }: { preview: boolean },
): Exclude<SchedulePhase, "unannounced"> | null {
  if (!conference) return null;
  // 目前年度三個時間點都要填，且公告上線不晚於報名開放（資料庫限制），所以公告上線前一定還沒開放報名。
  if (conference.phase === "unannounced") return preview ? "upcoming" : null;
  return conference.phase;
}

export function schedulePhase(schedule: Schedule, now: Date): SchedulePhase {
  if (!reached(schedule.announceAt, now)) return "unannounced";
  if (!reached(schedule.registrationOpensAt, now)) return "upcoming";
  if (!reached(schedule.registrationClosesAt, now)) return "open";
  return "closed";
}

function reached(moment: Date | null, now: Date): boolean {
  return moment !== null && now >= moment;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}
