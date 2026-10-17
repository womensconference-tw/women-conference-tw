import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { listRegistrations, REGISTRATION_STATUS_LABELS } from "@/lib/registration-list";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences } from "@/lib/years";
import { getCurrentStaff } from "../../current-staff";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { SubmitButton } from "../../submit-button";

export const metadata: Metadata = { title: "報名名單" };

/**
 * 報名名單：自己範圍內的報名，可依姓名、電話或報名編號搜尋。範圍由資料庫決定。
 * 預設是目前年度，可以選年度看舊年度的名單（範圍一樣）。
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

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">報名名單{selected && `（${selected.year} 年）`}</h1>
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
                <th className="p-2">狀態</th>
                <th className="p-2">報名時間</th>
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
                  <td className="p-2 whitespace-nowrap">{REGISTRATION_STATUS_LABELS[item.status]}</td>
                  <td className="p-2 whitespace-nowrap">{formatTime(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
