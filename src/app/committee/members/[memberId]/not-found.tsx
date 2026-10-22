import { NavLink } from "@/app/staff/nav-link";

/** 個人頁找不到（還沒到的年度、已刪除、網址打錯）。 */
export default function CommitteeMemberNotFound() {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-bold">找不到這位籌備委員</h1>
      <p className="text-committee-text-2">可能已經從名單上移除，或網址不完整。</p>
      <NavLink href="/committee/members" className="inline-flex min-h-11 items-center text-committee hover:text-committee-hover">
        ‹ 回到委員名單
      </NavLink>
    </div>
  );
}
