import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { STAFF_ROLE_LABELS } from "@/lib/staff";
import { cn } from "@/lib/utils";
import { signOut } from "../actions";
import { getCurrentStaff } from "../current-staff";
import { StaffNavLink } from "../staff-nav-link";
import { SubmitButton } from "../submit-button";

/**
 * 登入後的後台頁面。proxy 已經擋下沒登入的人；這裡再確認登入的人在工作人員名單裡，
 * 不在的（例如剛被移除）回登入頁，由登入頁說明並讓她登出。
 */
export default async function SignedInLayout({ children }: LayoutProps<"/staff">) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <nav className="flex flex-wrap items-center gap-4 font-semibold">
          <StaffNavLink href="/staff">後台首頁</StaffNavLink>
          <StaffNavLink href="/staff/registrations">報名名單</StaffNavLink>
          <StaffNavLink href="/staff/statistics">統計</StaffNavLink>
          <StaffNavLink href="/staff/committee">籌備委員會</StaffNavLink>
          {staff.role === "admin" && <StaffNavLink href="/staff/content">首頁內容</StaffNavLink>}
          {staff.role === "admin" && <StaffNavLink href="/staff/programme">場地與課程</StaffNavLink>}
          {staff.role === "admin" && <StaffNavLink href="/staff/agenda">大會程序</StaffNavLink>}
          {staff.role === "admin" && <StaffNavLink href="/staff/stakes">支聯會與支會</StaffNavLink>}
          {staff.role === "admin" && <StaffNavLink href="/staff/years">年度管理</StaffNavLink>}
          {staff.role === "admin" && <StaffNavLink href="/staff/members">工作人員帳號</StaffNavLink>}
        </nav>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {staff.name ?? staff.email}（{STAFF_ROLE_LABELS[staff.role]}）
          </span>
          <form action={signOut}>
            <SubmitButton pendingLabel="登出中…" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              登出
            </SubmitButton>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
