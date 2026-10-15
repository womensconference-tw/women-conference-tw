import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { listRegistrations, REGISTRATION_STATUS_LABELS } from "@/lib/registration-list";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../current-staff";
import { buttonClass, formatTime, inputClass } from "../../ui";

export const metadata: Metadata = { title: "報名名單" };

/** 報名名單：目前年度、自己範圍內的報名，可依姓名、電話或報名編號搜尋。範圍由資料庫決定。 */
export default async function RegistrationsPage({ searchParams }: PageProps<"/staff/registrations">) {
  const supabase = await createClient();
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");

  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const { items, total } = await listRegistrations(supabase, query);

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">報名名單</h1>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-semibold">姓名、電話或報名編號</span>
          <input name="q" type="search" defaultValue={query} autoComplete="off" className={inputClass} />
        </label>
        <button className={cn(buttonVariants(), buttonClass, "font-bold")}>搜尋</button>
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
