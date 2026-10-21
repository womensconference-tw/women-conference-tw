import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { REGISTRANT_ROLE_LABELS } from "@/lib/registration";
import {
  isRegistrationFilter,
  listRegistrations,
  REGISTRATION_STATUS_LABELS,
  type RegistrationFilter,
} from "@/lib/registration-list";
import { allowedExports, staffExportFileName } from "@/lib/staff-export";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences } from "@/lib/years";
import { getCurrentStaff } from "../../current-staff";
import { ResultMessage } from "../../result-message";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { SubmitButton } from "../../submit-button";
import { ExportButtons } from "./export-buttons";

export const metadata: Metadata = { title: "報名名單" };

const FILTERS: Record<RegistrationFilter, string> = { duplicates: "只看疑似重複", cross_region: "只看跨區" };

/** 名單上的小標籤：疑似重複、跨區。 */
function Tag({ children }: { children: string }) {
  return (
    <span className="ml-2 inline-block rounded border border-current px-1.5 text-sm font-semibold whitespace-nowrap">
      {children}
    </span>
  );
}

const DONE = { added: "已新增報名。", updated: "已儲存修改。", cancelled: "已取消報名。" };

/**
 * 報名名單：自己範圍內的報名，可依姓名、電話或報名編號搜尋。範圍由資料庫決定。
 * 預設是目前年度，可以選年度看舊年度的名單（範圍一樣）。
 * 標出疑似重複（同支會同名）與跨區（場地和支聯會不在同一區），也可以只看其中一種（#24）。
 * 總管理員可以新增、修改、取消目前年度的報名（#17）；課務組、報報組只能看。
 * 可以下載所選年度的 CSV（#20），只顯示自己角色能用的幾種，內容是自己範圍內的。
 */
export default async function RegistrationsPage({ searchParams }: PageProps<"/staff/registrations">) {
  const supabase = await createClient();
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");

  const { q, year: yearParam, show } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const filter = isRegistrationFilter(show) ? show : undefined;
  const years = await listConferences(supabase);
  // 沒選、或選的年度不在清單裡（網址被改過）時，是目前年度；還沒有目前年度時沒有報名可列。
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent);
  const { items, total } = await listRegistrations(supabase, query, selected?.year, filter);
  const canEdit = me.role === "admin" && Boolean(selected?.isCurrent);
  // 總管理員每一年度的報名都能打開詳細頁看寄信紀錄（#18）；只有目前年度的有效報名能修改。
  const canView = me.role === "admin";

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
      {selected && (
        <ExportButtons
          year={selected.year}
          exports={allowedExports(me.role).map((kind) => ({ kind, fileName: staffExportFileName(kind, selected.year) }))}
        />
      )}
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
        <label className="flex flex-col gap-1 sm:w-48">
          <span className="font-semibold">顯示</span>
          <select name="show" defaultValue={filter ?? ""} className={inputClass}>
            <option value="">全部</option>
            {Object.entries(FILTERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton navigates pendingLabel="搜尋中…" className={cn(buttonVariants(), buttonClass, "font-bold")}>
          搜尋
        </SubmitButton>
      </form>

      {filter && (
        <p className="text-muted-foreground">
          {filter === "duplicates"
            ? "疑似重複：姓名相同、支會也相同的有效報名，可能是同一位姐妹被報了兩次，請確認後處理。"
            : "跨區：所選教堂和她的支聯會不在同一區的有效報名。"}
        </p>
      )}
      <p role="status">
        {query.trim() || filter ? `找到 ${total} 筆` : `共 ${total} 筆`}
        {!filter && "（含已取消）"}
        {total > items.length &&
          (filter === "duplicates"
            ? `，依支會與姓名排序只列出前 ${items.length} 筆，請用搜尋縮小範圍`
            : `，只列出最新的 ${items.length} 筆，請用搜尋縮小範圍`)}
        。
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
                {canView && <th className="p-2"><span className="sr-only">修改／查看</span></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={cn("border-b", item.status === "cancelled" && "text-muted-foreground")}>
                  <td className="p-2 font-semibold">
                    {item.name}
                    {item.suspectedDuplicate && <Tag>疑似重複</Tag>}
                  </td>
                  <td className="p-2 whitespace-nowrap">{item.phone ?? `編號 ${item.registrationNumber}`}</td>
                  <td className="p-2">
                    {item.stakeName}／{item.wardName}
                  </td>
                  <td className="p-2">
                    {item.venueName}
                    {item.crossRegion && <Tag>跨區</Tag>}
                  </td>
                  <td className="p-2 whitespace-nowrap">{REGISTRANT_ROLE_LABELS[item.role]}</td>
                  <td className="p-2 whitespace-nowrap">{REGISTRATION_STATUS_LABELS[item.status]}</td>
                  <td className="p-2 whitespace-nowrap">{formatTime(item.createdAt)}</td>
                  {canView && (
                    <td className="p-2 whitespace-nowrap">
                      {/* 已取消、舊年度的不能修改，但可以看寄信紀錄（例如取消信有沒有寄出）。 */}
                      <Link href={`/staff/registrations/${item.id}`} className="font-semibold underline">
                        {canEdit && item.status === "registered" ? "修改" : "查看"}
                      </Link>
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
