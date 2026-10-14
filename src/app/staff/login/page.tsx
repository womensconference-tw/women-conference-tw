import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { sendSignInLink, signOut } from "../actions";
import { getCurrentStaff } from "../current-staff";
import { alertClass, buttonClass, inputClass, noticeClass } from "../ui";

export const metadata: Metadata = { title: "登入" };

const ERRORS: Record<string, string> = {
  email_invalid: "Email 格式不對，請再檢查一次。",
  link_invalid: "登入連結已失效或已經用過，請重新寄一次。",
  not_staff: "這個 Email 不是後台工作人員，請聯絡總管理員。",
};

/** 後台登入：填 Email，收信點連結登入。帳號由總管理員新增，這裡不能註冊。 */
export default async function StaffLoginPage({ searchParams }: PageProps<"/staff/login">) {
  if (await getCurrentStaff()) redirect("/staff");
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  const { error, sent } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5">
      <h1 className="text-2xl font-bold">台灣姐妹大會後台登入</h1>
      {/* 有登入帳號但已經不在工作人員名單裡（例如被移除），讓她登出換 Email。 */}
      {user ? (
        <>
          <p className={alertClass}>{ERRORS.not_staff}</p>
          <form action={signOut}>
            <button className={cn(buttonVariants({ variant: "outline" }), buttonClass)}>登出</button>
          </form>
        </>
      ) : sent ? (
        <p className={noticeClass} role="status">
          如果這個 Email 是後台工作人員，登入連結已經寄出，請到信箱收信。連結 1 小時內有效；幾分鐘後還沒收到，請再寄一次。
        </p>
      ) : (
        <form action={sendSignInLink} className="flex flex-col gap-4">
          {message && (
            <p role="alert" className={alertClass}>
              {message}
            </p>
          )}
          <label htmlFor="email" className="font-semibold">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
          <button className={cn(buttonVariants(), buttonClass, "font-bold")}>寄登入連結</button>
          <p className="text-sm text-muted-foreground">後台帳號由總管理員新增，不能自行註冊。</p>
        </form>
      )}
    </main>
  );
}
