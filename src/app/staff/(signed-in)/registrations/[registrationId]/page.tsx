import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import type { EmailKind } from "@/lib/confirmation-email";
import { getEmailLogs, type EmailLog } from "@/lib/email-logs";
import { getRegistrationForEdit } from "@/lib/registration-list";
import { getRegistrationOptions } from "@/lib/registration-options";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../../current-staff";
import { ResultMessage } from "../../../result-message";
import { SubmitButton } from "../../../submit-button";
import { buttonClass, formatTime } from "../../../ui";
import { cancelRegistrationByStaff, resendConfirmation } from "../actions";
import { RegistrationEditor } from "../registration-editor";

export const metadata: Metadata = { title: "修改報名" };

const DONE = { resent: "確認信已經寄出。" };

const ERRORS = {
  notAllowed: "只有總管理員能取消報名。",
  notFound: "找不到這筆報名，可能不是目前年度的報名。",
  unknown: "系統暫時出了問題，沒有取消。請稍後再試一次。",
  resend_notAllowed: "只有總管理員能重寄確認信。",
  resend_notFound: "找不到這筆報名，可能不是目前年度的報名。",
  resend_skipped: "沒有寄出：這筆報名剛剛被取消、Email 被清空，或已經清除個資。",
  resend_cancelled: "這筆報名已經取消，不能重寄確認信。",
  resend_noEmail: "這筆報名沒有填 Email，無法寄送確認信。",
  resend_failed: "確認信沒有寄出，原因記在下面的寄信紀錄。請稍後再試一次。",
  resend_unknown: "系統暫時出了問題，確認信可能沒有寄出。請看下面的寄信紀錄，或稍後再試一次。",
};

const KIND_LABELS: Record<EmailKind, string> = {
  registered: "報名完成",
  updated: "報名修改",
  cancelled: "報名取消",
  resent: "重寄確認信",
};

const STATUS_LABELS: Record<EmailLog["status"], string> = {
  sending: "寄送中",
  sent: "已寄出",
  failed: "失敗",
};

/**
 * 後台修改、取消一筆報名（只有總管理員）：目前年度的報名，不受報名期間限制，可以改身分類別。
 * 已取消的報名只能看，不能修改。下方列出寄信紀錄，可以重寄確認信（#18）。
 */
export default async function EditRegistrationPage({
  params,
  searchParams,
}: PageProps<"/staff/registrations/[registrationId]">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const supabase = await createClient();
  const { registrationId } = await params;
  const registration = await getRegistrationForEdit(supabase, registrationId);
  if (!registration || !registration.isCurrentYear) notFound();
  const [options, emailLogs] = await Promise.all([
    getRegistrationOptions(supabase, "zh"),
    // 讀不到寄信紀錄時只在那一區說明，不讓整頁打不開、連修改與取消都不能做。
    getEmailLogs(supabase, registration.id).catch((error: unknown) => {
      console.error("讀不到寄信紀錄", { registrationId: registration.id, name: (error as Error)?.name });
      return null;
    }),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      <Link href="/staff/registrations" className="font-semibold underline">
        ← 回到報名名單
      </Link>
      <h1 className="text-2xl font-bold">
        {registration.status === "cancelled" ? "查看報名" : "修改報名"}：{registration.name}
      </h1>
      {registration.status === "cancelled" ? (
        <p>這筆報名已經取消，不能修改。</p>
      ) : (
        <>
          <RegistrationEditor options={options} registration={registration} />
          <details className="max-w-2xl rounded-lg border-2 border-card-outline p-4">
            <summary className="cursor-pointer font-semibold text-destructive">取消這筆報名</summary>
            <form action={cancelRegistrationByStaff} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="registrationId" value={registration.id} />
              <p>取消後名額立即釋出，紀錄保留。有填 Email 的話會寄取消通知給她。確定要取消嗎？</p>
              <SubmitButton
                pendingLabel="取消中…"
                className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}
              >
                確定取消報名
              </SubmitButton>
            </form>
          </details>
        </>
      )}
      <EmailSection
        registrationId={registration.id}
        email={registration.email}
        cancelled={registration.status === "cancelled"}
        logs={emailLogs}
      />
    </main>
  );
}

/** 確認信：重寄按鈕與這筆報名的所有寄信紀錄（最新的在最前面）。 */
function EmailSection({
  registrationId,
  email,
  cancelled,
  logs,
}: {
  registrationId: string;
  email: string | null;
  cancelled: boolean;
  /** 讀不到時是 null。 */
  logs: EmailLog[] | null;
}) {
  return (
    <section className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-xl font-bold">確認信</h2>
      {cancelled ? (
        <p>這筆報名已經取消，不能重寄確認信。</p>
      ) : !email ? (
        <p>這筆報名沒有填 Email，無法寄送確認信。</p>
      ) : (
        <form action={resendConfirmation} className="flex flex-col gap-2">
          <input type="hidden" name="registrationId" value={registrationId} />
          <p>
            寄一封確認信到 <span className="font-semibold break-all">{email}</span>
            ，內容是目前存好的報名資料（還沒按儲存的修改不會寄出），用她報名時的語言。
          </p>
          <SubmitButton pendingLabel="寄送中…" className={cn(buttonVariants({ variant: "outline" }), buttonClass, "self-start")}>
            重寄確認信
          </SubmitButton>
        </form>
      )}

      <h3 className="text-lg font-semibold">寄信紀錄</h3>
      {logs === null ? (
        <p className="text-destructive">系統暫時讀不到寄信紀錄，請稍後重新整理。</p>
      ) : logs.length === 0 ? (
        <p>還沒有寄過信。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2">
                <th className="p-2">類型</th>
                <th className="p-2">時間</th>
                <th className="p-2">結果</th>
                <th className="p-2">收件地址</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b align-top">
                  <td className="p-2 whitespace-nowrap">{KIND_LABELS[log.kind] ?? log.kind}</td>
                  <td className="p-2 whitespace-nowrap">{formatTime(log.createdAt)}</td>
                  <td className="p-2">
                    <span className={cn("font-semibold whitespace-nowrap", log.status === "failed" && "text-destructive")}>
                      {STATUS_LABELS[log.status] ?? log.status}
                    </span>
                    {log.error && <span className="block text-sm break-all text-muted-foreground">{log.error}</span>}
                  </td>
                  <td className="p-2 break-all">{log.recipient ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
