import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLocale, type Locale } from "./i18n/locale";
import { localized } from "./i18n/localized";
import { messages, type Messages } from "./i18n/messages";
import {
  summarizeRegistration,
  type Details,
  type SummaryOptions,
  type SummaryRow,
} from "./registration-summary";

/*
 * 確認信：報名、修改、取消成功後，各寄一封到該筆報名的 Email（一位一封；Email 是空的就不寄）。
 * 信件用報名語言，內容與完成頁、查詢頁的報名資料清單相同（summarizeRegistration）。
 * 寄信失敗不影響報名，只記在寄信紀錄（email_logs）。
 * 開始寄信、寫回結果都由資料庫函式負責，只開放給網站伺服器（createServiceClient）。
 */

/** 確認信的類型：報名、修改、取消。與資料庫 email_logs_kind_valid 用同一組代碼。 */
export type EmailKind = "registered" | "updated" | "cancelled";

export type EmailMessage = { to: string; subject: string; html: string; text: string };

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

/** 實際寄信的方式。正式環境用 Resend（createResendSender），測試換成不寄信的假的。 */
export type SendEmail = (message: EmailMessage) => Promise<SendResult>;

// 資料庫卡住時不能一直等：寄信的工作被平台停掉，寄信紀錄就會停在寄送中。
const DATABASE_TIMEOUT_MS = 10_000;
// 寫回寄送結果失敗時（例如資料庫暫時沒回應）再試幾次、每次等多久。只重試寫回，不重寄信。
const FINISH_RETRY_DELAYS_MS = [500, 2_000];

/**
 * 寄一封確認信，並記在寄信紀錄。不丟出例外：寄信失敗或出錯時記下失敗，報名照樣成功。
 * 回傳 skipped 表示不寄（見 begin_confirmation_email）。
 * siteUrl 有值時，信裡附上「查詢我的報名」的連結。
 * 伺服器日誌只記寄信紀錄的編號，不記錯誤內容：錯誤可能含收件地址或姓名，清除個資時清不到日誌。
 * 錯誤內容只寫進寄信紀錄，由 finish_email_log 依清除個資的狀態決定要不要留。
 */
export async function sendConfirmationEmail(
  supabase: SupabaseClient,
  registrationId: string,
  kind: EmailKind,
  send: SendEmail,
  siteUrl?: string,
): Promise<"sent" | "failed" | "skipped"> {
  let logId: string | undefined;
  let result: SendResult;
  try {
    const begun = await supabase
      .rpc("begin_confirmation_email", { p_registration_id: registrationId, p_kind: kind })
      .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
    if (begun.error) throw begun.error;
    const { log_id, registration } = begun.data as { log_id?: string; registration?: EmailRow };
    if (!log_id || !registration) return "skipped";
    logId = log_id;

    const locale = parseLocale(registration.locale);
    const t = messages[locale];
    const details = detailsOf(registration, locale);
    const registrationNumber = registration.registration_number;
    const summary = summarizeRegistration(details, optionsOf(registration, locale), t, {
      done: true,
      registrationNumber,
    });
    const lookupUrl = siteUrl ? new URL("/lookup", siteUrl).toString() : undefined;
    const content = confirmationEmail(kind, details.name, registrationNumber, summary, t, lookupUrl);
    result = await send({ to: registration.email, ...content });
  } catch (error) {
    if (!logId) {
      // 還沒開始寄信、也沒有寄信紀錄：這裡的錯誤來自資料庫，不含信件內容。
      console.error("confirmation email not started", { registrationId, kind, error });
      return "failed";
    }
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (!(await finishEmailLog(supabase, logId, result))) {
    // 寄信紀錄會停在寄送中；這時看 Resend 後台的紀錄才知道有沒有寄出。
    console.error("finish_email_log failed", { logId, sent: result.ok });
  }
  if (!result.ok) console.error("confirmation email failed", { logId });
  return result.ok ? "sent" : "failed";
}

/** 寫回寄送結果，失敗時有限次重試。重複寫回不會蓋掉第一次的結果（見 finish_email_log）。 */
async function finishEmailLog(supabase: SupabaseClient, logId: string, result: SendResult): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase
      .rpc("finish_email_log", {
        p_log_id: logId,
        p_sent: result.ok,
        p_error: result.ok ? null : result.error,
        p_provider_message_id: result.ok ? result.id : null,
      })
      .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
    if (!error) return true;
    if (attempt >= FINISH_RETRY_DELAYS_MS.length) return false;
    await new Promise((resolve) => setTimeout(resolve, FINISH_RETRY_DELAYS_MS[attempt]));
  }
}

/** 確認信的主旨與內容（HTML 與純文字兩個版本）。報名編號放在最前面，和完成頁一樣。 */
function confirmationEmail(
  kind: EmailKind,
  name: string,
  registrationNumber: string | null,
  { rows, courses, extraRows }: ReturnType<typeof summarizeRegistration>,
  t: Messages,
  lookupUrl: string | undefined,
): Omit<EmailMessage, "to"> {
  const allRows: SummaryRow[] = [
    ...(registrationNumber ? [{ label: t.register.done.registrationNumberLabel, value: registrationNumber }] : []),
    ...rows,
    ...courses.map(({ session, course }) => ({ label: session, value: course })),
    ...extraRows,
  ];
  const greeting = t.email.greeting(name.trim());
  const intro = t.email.intros[kind];

  const text = [
    greeting,
    "",
    intro,
    "",
    ...allRows.map(({ label, value }) => `${label}${t.email.labelSeparator}${value}`),
    "",
    t.email.lookupHint,
    ...(lookupUrl ? [lookupUrl] : []),
    "",
    t.email.footer,
  ].join("\n");

  const cell = "padding:4px 12px 4px 0;vertical-align:top;text-align:left";
  const html = `<!doctype html>
<html><body style="font-family:sans-serif;font-size:16px;line-height:1.6;color:#222">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
<table style="border-collapse:collapse;margin:16px 0">
${allRows
  .map(
    ({ label, value }) =>
      `<tr><th style="${cell};white-space:nowrap">${escapeHtml(label)}</th><td style="${cell}">${escapeHtml(value)}</td></tr>`,
  )
  .join("\n")}
</table>
<p>${escapeHtml(t.email.lookupHint)}${
    lookupUrl ? `<br><a href="${escapeHtml(lookupUrl)}">${escapeHtml(t.email.lookupLink)}</a>` : ""
  }</p>
<p style="color:#666;font-size:14px">${escapeHtml(t.email.footer)}</p>
</body></html>`;

  return { subject: t.email.subjects[kind], html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** begin_confirmation_email 回傳的報名資料。 */
type EmailRow = {
  name: string;
  phone: string | null;
  registration_number: string | null;
  email: string;
  line_id: string | null;
  stake_id: string;
  ward_id: string;
  venue_id: string;
  course_ids: string[];
  lunch_option_id: string | null;
  afternoon_activity_id: string | null;
  choir_part: string | null;
  services: string[];
  printed_handbook: boolean;
  locale: string;
  stake_name_zh: string;
  stake_name_en: string;
  ward_name_zh: string;
  ward_name_en: string;
  venue: {
    name_zh: string;
    name_en: string;
    sessions: {
      id: string;
      name_zh: string;
      name_en: string;
      courses: { id: string; title_zh: string; title_en: string }[];
    }[];
    lunch_options: { id: string; name_zh: string; name_en: string }[];
    afternoon_activities: { id: string; title_zh: string; title_en: string }[];
  };
};

/** 她報名的場地的名稱，依語言挑好。支聯會、支會的名稱放在 Details 裡（detailsOf），這裡不用。 */
function optionsOf(row: EmailRow, locale: Locale): SummaryOptions {
  const { venue } = row;
  return {
    venues: [
      {
        id: row.venue_id,
        name: localized(venue, "name", locale),
        sessions: venue.sessions.map((session) => ({
          name: localized(session, "name", locale),
          courses: session.courses.map((course) => ({ id: course.id, name: localized(course, "title", locale) })),
        })),
        lunchOptions: venue.lunch_options.map((lunch) => ({ id: lunch.id, name: localized(lunch, "name", locale) })),
        afternoonActivities: venue.afternoon_activities.map((activity) => ({
          id: activity.id,
          name: localized(activity, "title", locale),
        })),
      },
    ],
    stakes: [],
  };
}

function detailsOf(row: EmailRow, locale: Locale): Details {
  return {
    name: row.name,
    phone: row.phone,
    noPhone: row.phone === null,
    email: row.email,
    lineId: row.line_id,
    stakeId: row.stake_id,
    wardId: row.ward_id,
    venueId: row.venue_id,
    courseIds: row.course_ids,
    lunchOptionId: row.lunch_option_id,
    afternoonActivityId: row.afternoon_activity_id,
    choirPart: row.choir_part,
    services: row.services,
    printedHandbook: row.printed_handbook,
    // 報名後支聯會、支會可能已停用，不在報名表的選項裡，所以名稱由資料庫給。
    stakeName: localized(row, "stake_name", locale),
    wardName: localized(row, "ward_name", locale),
  };
}

const RESEND_TIMEOUT_MS = 10_000;

/**
 * 用 Resend 寄信。API key（RESEND_API_KEY）與寄件人（EMAIL_FROM）只放在伺服器的環境變數；
 * 沒設定時不寄，回傳失敗，寄信紀錄會記下原因。
 */
export function createResendSender(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): SendEmail {
  return async ({ to, subject, html, text }) => {
    const apiKey = env.RESEND_API_KEY;
    const from = env.EMAIL_FROM;
    if (!apiKey || !from) return { ok: false, error: "RESEND_API_KEY or EMAIL_FROM not set" };
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      // Resend 卡住時不能一直等：寄信的工作被平台停掉，寄信紀錄就會停在寄送中，看不出失敗。
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) return { ok: false, error: `${response.status} ${body.message ?? response.statusText}` };
    return { ok: true, id: body.id ?? null };
  };
}
