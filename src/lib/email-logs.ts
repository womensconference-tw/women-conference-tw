import type { SupabaseClient } from "@supabase/supabase-js";
import { sendConfirmationEmail, type EmailKind, type SendEmail } from "./confirmation-email";
import { getRegistrationForEdit } from "./registration-list";

/*
 * 後台的寄信紀錄檢視與重寄確認信（#18），只有總管理員。
 * 讀寄信紀錄用登入的工作人員身分，權限由資料庫決定（只有總管理員讀得到）。
 */

export type EmailLog = {
  id: string;
  kind: EmailKind;
  /** 寄出當下的收件地址；清除個資後是 null。 */
  recipient: string | null;
  /** 寄送中：沒寫回結果，表示寄信的工作中途停掉了。 */
  status: "sending" | "sent" | "failed";
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/** 一筆報名的所有寄信紀錄，最新的在最前面。讀不到（不是總管理員）時是空的。 */
export async function getEmailLogs(supabase: SupabaseClient, registrationId: string): Promise<EmailLog[]> {
  const { data, error } = await supabase
    .from("email_logs")
    .select("id, kind, recipient, status, error, created_at, finished_at")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    kind: row.kind,
    recipient: row.recipient,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));
}

export type ResendError =
  | "notAllowed"
  /** 找不到這筆報名，或不是目前年度的報名。 */
  | "notFound"
  | "cancelled"
  /** 這筆報名沒有 Email。 */
  | "noEmail"
  /** 寄信失敗，寄信紀錄記下了原因。 */
  | "failed"
  /** 沒有寄：讀完報名到開始寄信之間，報名被取消、Email 被清空，或該年度清除了個資（見 begin_confirmation_email）。 */
  | "skipped";

export type ResendResult = { ok: true } | { ok: false; error: ResendError };

/**
 * 重寄確認信：寄出目前內容的確認信（用報名語言、寄到目前的 Email），記一筆重寄的寄信紀錄。
 * staff 是登入的工作人員：先確認她是總管理員、讀得到這筆目前年度的報名，
 * 再用網站伺服器的身分（server）寄信，因為開始寄信、寫回結果的資料庫函式只開放給網站伺服器。
 * 等寄完才回傳，總管理員馬上知道寄成了沒有。
 */
export async function resendConfirmationEmail(
  staff: SupabaseClient,
  server: SupabaseClient,
  registrationId: string,
  send: SendEmail,
  siteUrl?: string,
): Promise<ResendResult> {
  // 先確認是總管理員再讀報名：訪客讀報名會直接被資料庫拒絕（丟出錯誤）。
  const { data: isAdmin, error } = await staff.rpc("is_staff_admin");
  // 訪客沒有呼叫權限，會拿到錯誤；當成不是總管理員。
  if (error || isAdmin !== true) return { ok: false, error: "notAllowed" };

  const registration = await getRegistrationForEdit(staff, registrationId);
  if (!registration || !registration.isCurrentYear) return { ok: false, error: "notFound" };
  if (registration.status === "cancelled") return { ok: false, error: "cancelled" };
  if (!registration.email) return { ok: false, error: "noEmail" };

  const outcome = await sendConfirmationEmail(server, registrationId, "resent", send, siteUrl);
  if (outcome === "sent") return { ok: true };
  return { ok: false, error: outcome };
}
