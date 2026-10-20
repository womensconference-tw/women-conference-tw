import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  getYearExportOverview,
  yearExcelFileName,
  type ClearPersonalDataError,
  type YearExportRecord,
} from "@/lib/year-export";
import { getCurrentStaff } from "../../../current-staff";
import { ResultMessage } from "../../../result-message";
import { SubmitButton } from "../../../submit-button";
import { alertClass, buttonClass, formatTime, noticeClass } from "../../../ui";
import { clearYearPersonalData } from "../actions";
import { DownloadButton } from "./download-button";

export const metadata: Metadata = { title: "下載 Excel 與清除個資" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";

const DONE = {
  cleared: "已清除這個年度的個資。名單與統計仍可查看，需要姓名時請用剛才存好的 Excel。",
  already_cleared: "這個年度之前已經清除過個資，清除時間沒有改變。",
};

const ERRORS: Record<ClearPersonalDataError, string> = {
  not_admin: "只有總管理員能清除個資。",
  not_found: "找不到這個年度，請重新整理頁面再試一次。",
  conference_not_ended: "大會還沒結束，不能清除個資。",
  personal_data_cleared: "這個年度已經清除個資。",
  not_confirmed: "請先打開下載的 Excel 確認內容，再勾選「Excel 已存好、打得開」。",
  export_not_found: "找不到這一筆下載紀錄，請重新下載 Excel 再清除。",
  export_not_mine: "這一份是別的總管理員下載的。請用你自己下載、打開確認過的那一份清除。",
  export_outdated: "下載之後報名資料有變動，這份 Excel 不是最新的。沒有清除任何資料，請重新下載 Excel、確認之後再清除。",
  unavailable: "系統暫時出了問題，沒有清除任何資料。請稍後再試一次。",
};

/**
 * 大會結束後下載年度 Excel、確認存好再清除個資（只有總管理員，#26、ADR 0008）。
 * 先下載；打開確認之後，在那一筆下載紀錄勾選「Excel 已存好、打得開」再清除。
 * 多位總管理員或多個分頁下載時，各自確認自己那一份；下載之後報名有變動的那一份不能用來清除。
 */
export default async function YearPersonalDataPage({
  params,
  searchParams,
}: PageProps<"/staff/years/[conferenceId]">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const { conferenceId } = await params;
  const supabase = await createClient();
  const [{ data: conference }, overview] = await Promise.all([
    supabase.from("conferences").select("id, year, conference_date").eq("id", conferenceId).maybeSingle(),
    getYearExportOverview(supabase, conferenceId),
  ]);
  if (!conference || !overview) notFound();

  return (
    <main className="flex max-w-3xl flex-col gap-6">
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      <Link href="/staff/years" className="font-semibold underline">
        ← 回到年度管理
      </Link>
      <h1 className="text-2xl font-bold">{conference.year} 年：下載 Excel 與清除個資</h1>
      <p>
        大會結束後，先下載這個年度的 Excel 名單（給籌備委員會核對與致謝用），打開確認存好了，再清除資料庫裡的個資。
        清除後報名紀錄還在，統計照樣可以看，只是姓名、電話、報名編號、Email、LINE ID 都會清掉，<strong>不能還原</strong>。
        Excel 裡有姓名，請存在只有籌備委員會能打開的地方。
      </p>

      {overview.clearedAt ? (
        <p className={noticeClass}>
          已於 {formatTime(overview.clearedAt)} 清除個資。名單與統計仍可查看，但不能再下載 Excel、補寄確認信或修改報名。
        </p>
      ) : !overview.ended ? (
        <p className={noticeClass}>
          大會還沒結束。大會日期（{conference.conference_date}）翌日台北時間 00:00 之後，才能下載 Excel 與清除個資。
        </p>
      ) : (
        <>
          <section className={cardClass}>
            <h2 className="text-xl font-bold">第一步：下載年度 Excel</h2>
            <p>
              工作表「名單」一列一位有效報名的姐妹（已取消的不列），「場次對照」列出每個場地各場次的名稱與時間。
              不含電話、Email、LINE ID、報名編號、支聯會、支會。
            </p>
            <DownloadButton conferenceId={conference.id} fileName={yearExcelFileName(conference.year)} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">第二步：確認 Excel 存好了，再清除個資</h2>
            {overview.exports.length === 0 ? (
              <p>還沒有下載過。請先下載 Excel。</p>
            ) : (
              overview.exports.map((record) => (
                <ExportRecord
                  key={record.id}
                  conferenceId={conference.id}
                  year={conference.year}
                  record={record}
                  registrationTotal={overview.registrationTotal}
                />
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}

/** 一筆下載紀錄：資料沒變動的話，可以勾選確認、清除個資。 */
function ExportRecord({
  conferenceId,
  year,
  record,
  registrationTotal,
}: {
  conferenceId: string;
  year: number;
  record: YearExportRecord;
  registrationTotal: number;
}) {
  return (
    <article className={cardClass}>
      <h3 className="text-lg font-bold">
        {formatTime(record.completedAt)} 下載{record.exportedByName && `（${record.exportedByName}）`}
      </h3>
      {record.outdated ? (
        <p className={alertClass}>這份下載之後報名資料有變動，不能用來清除。請重新下載 Excel，用新的那一份確認。</p>
      ) : !record.mine ? (
        <p>這份是別的總管理員下載的，請她自己確認後清除；或者你自己下載一份，打開確認之後再清除。</p>
      ) : (
        <form action={clearYearPersonalData} className="flex flex-col gap-3">
          <input type="hidden" name="conferenceId" value={conferenceId} />
          <input type="hidden" name="exportId" value={record.id} />
          <ul className="list-disc pl-6">
            <li>Excel 內的有效報名 {record.registrationCount} 筆</li>
            <li>將清除個資的報名 {registrationTotal} 筆（含已取消）</li>
          </ul>
          <label className="flex items-start gap-2 font-semibold">
            <input type="checkbox" name="confirmed" required className="mt-1 size-5" />
            這份 Excel 已存好、打得開（我打開看過，姓名都在）
          </label>
          <p className={alertClass}>清除後不能還原。需要姓名的工作只能靠這份 Excel。</p>
          <SubmitButton
            pendingLabel="清除中…"
            className={cn(buttonVariants(), buttonClass, "self-start bg-destructive font-bold text-white hover:bg-destructive/80")}
          >
            清除 {year} 年的個資
          </SubmitButton>
        </form>
      )}
    </article>
  );
}
