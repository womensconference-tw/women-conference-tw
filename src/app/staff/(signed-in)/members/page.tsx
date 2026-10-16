import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  listStaffMembers,
  REGION_LABELS,
  REGIONS,
  STAFF_ROLE_LABELS,
  STAFF_ROLES,
  type StaffListItem,
  type StaffMember,
} from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../current-staff";
import { ResultMessage } from "../../result-message";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { addMember, removeMember, updateMember } from "./actions";

export const metadata: Metadata = { title: "工作人員帳號" };

const DONE: Record<string, string> = {
  added: "已新增。請告訴她用這個 Email 到後台登入頁收登入連結。",
  updated: "已更新角色與負責範圍。",
  removed: "已移除，她的登入帳號也一併刪除。",
};

const ERRORS: Record<string, string> = {
  email_invalid: "Email 格式不對，請再檢查一次。",
  not_admin: "只有總管理員能管理工作人員帳號。",
  scope_invalid: "課務組要選一區；總管理員不分區。",
  already_staff: "這個 Email 已經是工作人員了。",
  last_admin: "至少要留一位總管理員，請先新增另一位總管理員。",
  staff_not_found: "找不到這位工作人員，可能已經被移除。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

/** 工作人員帳號（只有總管理員）：新增、修改角色與負責範圍、移除。 */
export default async function StaffMembersPage({ searchParams }: PageProps<"/staff/members">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const members = await listStaffMembers(await createClient());

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">工作人員帳號</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />

      <section className="flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4">
        <h2 className="text-xl font-bold">新增工作人員</h2>
        <p className="text-sm text-muted-foreground">
          新增後不會自動寄信。請告訴她到後台登入頁填這個 Email，收信點連結就能登入。
        </p>
        <form action={addMember} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Email</span>
            <input name="email" type="email" autoComplete="off" required className={inputClass} />
          </label>
          <ScopeFields />
          <button className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>新增</button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">目前的工作人員（{members.length} 位）</h2>
        <ul className="flex flex-col gap-4">
          {members.map((member) => (
            <MemberCard key={member.userId} member={member} me={me} />
          ))}
        </ul>
      </section>
    </main>
  );
}

function MemberCard({ member, me }: { member: StaffListItem; me: StaffMember }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold break-all">
          {member.email}
          {member.userId === me.userId && "（你）"}
        </span>
        <span className="text-sm text-muted-foreground">
          {member.lastSignInAt ? `上次登入 ${formatTime(member.lastSignInAt)}` : "還沒登入過"}
        </span>
      </div>
      <form action={updateMember} className="flex flex-col gap-3">
        <input type="hidden" name="userId" value={member.userId} />
        <ScopeFields member={member} />
        <button className={cn(buttonVariants({ variant: "outline" }), buttonClass, "self-start")}>
          儲存角色與範圍
        </button>
      </form>
      {/* 不用跳出視窗，展開後再按一次才移除。 */}
      <details>
        <summary className="cursor-pointer font-semibold text-destructive">移除這位工作人員</summary>
        <form action={removeMember} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="userId" value={member.userId} />
          <p>移除後她的登入帳號會一起刪除，不能再登入後台。</p>
          <button
            className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}
          >
            確定移除
          </button>
        </form>
      </details>
    </li>
  );
}

/** 角色與負責範圍。課務組要選一區；報報組選一區或全區；總管理員不分區，送出時不用區。 */
function ScopeFields({ member }: { member?: StaffListItem }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">角色</span>
        <select name="role" defaultValue={member?.role ?? "course_team"} className={inputClass}>
          {STAFF_ROLES.map((role) => (
            <option key={role} value={role}>
              {STAFF_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">負責的區（課務組、報報組）</span>
        <select name="region" defaultValue={member?.region ?? ""} className={inputClass}>
          <option value="">全區（只限報報組）</option>
          {REGIONS.map((region) => (
            <option key={region} value={region}>
              {REGION_LABELS[region]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
