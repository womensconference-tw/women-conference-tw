import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { REGISTRANT_ROLE_LABELS } from "@/lib/registration";
import { listRegistrations, REGISTRATION_STATUS_LABELS } from "@/lib/registration-list";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences } from "@/lib/years";
import { getCurrentStaff } from "../../current-staff";
import { ResultMessage } from "../../result-message";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { SubmitButton } from "../../submit-button";

export const metadata: Metadata = { title: "報名名單" };

const DONE = { added: "已新增報名。", updated: "已儲存修改。", cancelled: "已取消報名。" };

/**
 * 報名名單：自己範圍內的報名，可依姓名、電話或報名編號搜尋。範圍由資料庫決定。
 * 預設是目前年度，可以選年度看舊年度的名單（範圍一樣）。
 * 總管理員可以新增、修改、取消目前年度的報名（#17）；課務組、報報組只能看。
 */
export default async function RegistrationsPage({ searchParams }: PageProps<"/staff/registrations">) {
  const supabase = await createClient();
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");

  const { q, year: yearParam } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const years = await listConferences(supabase);
  // 沒選、或選的年度不在清單裡（網址被改過）時，是目前年度；還沒有目前年度時沒有報名可列。
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent);
  const { items, total } = await listRegistrations(supabase, query, selected?.year);
  const canEdit = me.role === "admin" && Boolean(selected?.isCurrent);

  return (
    <main className="flex flex-col gap-6">
      <ResultMessage searchParams={searchParams} done={DONE} errors={{}} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">報名名單{selected && `（${selected.year} 年）`}</h1>
        {canEdit && (
          <Link href="/staff/registrations/new" className={cn(buttonVariants(), buttonClass, "font-bold")}>
            新增報名
          </Link>
        )}
      </div>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {years.length > 1 && (
          <label className="flex flex-col gap-1 sm:w-48">
            <span className="font-semibold">年度</span>
            <select name="year" defaultValue={selected?.year} className={inputClass}>
              {years.map((year) => (
                <option key={year.id} value={year.year}>
                  {year.year} 年{year.isCurrent ? "（目前年度）" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-semibold">姓名、電話或報名編號</span>
          <input name="q" type="search" defaultValue={query} autoComplete="off" className={inputClass} />
        </label>
        <SubmitButton navigates pendingLabel="搜尋中…" className={cn(buttonVariants(), buttonClass, "font-bold")}>
          搜尋
        </SubmitButton>
      </form>

      <p role="status">
        {query.trim() ? `找到 ${total} 筆` : `共 ${total} 筆`}（含已取消）
        {total > items.length && `，只列出最新的 ${items.length} 筆，請用搜尋縮小範圍`}。
      </p>

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2">
                <th className="p-2">姓名</th>
                <th className="p-2">電話／報名編號</th>
                <th className="p-2">支聯會／支會</th>
                <th className="p-2">場地</th>
                <th className="p-2">身分類別</th>
                <th className="p-2">狀態</th>
                <th className="p-2">報名時間</th>
                {canEdit && <th className="p-2"><span className="sr-only">修改</span></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={cn("border-b", item.status === "cancelled" && "text-muted-foreground")}>
                  <td className="p-2 font-semibold">{item.name}</td>
                  <td className="p-2 whitespace-nowrap">{item.phone ?? `編號 ${item.registrationNumber}`}</td>
                  <td className="p-2">
                    {item.stakeName}／{item.wardName}
                  </td>
                  <td className="p-2">{item.venueName}</td>
                  <td className="p-2 whitespace-nowrap">{REGISTRANT_ROLE_LABELS[item.role]}</td>
                  <td className="p-2 whitespace-nowrap">{REGISTRATION_STATUS_LABELS[item.status]}</td>
                  <td className="p-2 whitespace-nowrap">{formatTime(item.createdAt)}</td>
                  {canEdit && (
                    <td className="p-2 whitespace-nowrap">
                      {item.status === "registered" && (
                        <Link href={`/staff/registrations/${item.id}`} className="font-semibold underline">
                          修改
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
