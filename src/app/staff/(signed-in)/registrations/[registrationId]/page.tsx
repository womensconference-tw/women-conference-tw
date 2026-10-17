import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getRegistrationForEdit } from "@/lib/registration-list";
import { getRegistrationOptions } from "@/lib/registration-options";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../../current-staff";
import { ResultMessage } from "../../../result-message";
import { SubmitButton } from "../../../submit-button";
import { buttonClass } from "../../../ui";
import { cancelRegistrationByStaff } from "../actions";
import { RegistrationEditor } from "../registration-editor";

export const metadata: Metadata = { title: "修改報名" };

const ERRORS = {
  notAllowed: "只有總管理員能取消報名。",
  notFound: "找不到這筆報名，可能不是目前年度的報名。",
  unknown: "系統暫時出了問題，沒有取消。請稍後再試一次。",
};

/**
 * 後台修改、取消一筆報名（只有總管理員）：目前年度的報名，不受報名期間限制，可以改身分類別。
 * 已取消的報名只能看，不能修改。
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
  const options = await getRegistrationOptions(supabase, "zh");

  return (
    <main className="flex flex-col gap-6">
      <ResultMessage searchParams={searchParams} done={{}} errors={ERRORS} />
      <Link href="/staff/registrations" className="font-semibold underline">
        ← 回到報名名單
      </Link>
      <h1 className="text-2xl font-bold">修改報名：{registration.name}</h1>
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
    </main>
  );
}
