import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences, type ConferenceYear, type YearError } from "@/lib/years";
import { getCurrentStaff } from "../../current-staff";
import { DateTimeField, Field } from "../../fields";
import { ResultMessage } from "../../result-message";
import { SubmitButton } from "../../submit-button";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { copyYear, makeCurrentYear } from "./actions";

export const metadata: Metadata = { title: "年度管理" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";
const submitClass = cn(buttonVariants(), buttonClass, "self-start font-bold");

const DONE: Record<string, string> = {
  copied: "已建立新年度。設為目前年度之前，首頁還是顯示原本的年度。",
  copied_without_some_pairs:
    "已建立新年度，但有成對課程因為去年調過場次順序、兩個場次不再相鄰，沒有複製。請到「場地與課程」重新設定這些成對課程。設為目前年度之前，首頁還是顯示原本的年度。",
  switched:
    "已設為目前年度，首頁改顯示這一年。公告上線前首頁只顯示「即將公布」，這段時間請到「首頁內容」「場地與課程」準備新年度。",
};

const ERRORS: Record<YearError, string> = {
  not_admin: "只有總管理員能管理年度。",
  year_invalid: "年度請填西元年，例如 2027。",
  year_taken: "這個年度已經有了，請換一個年度。",
  date_invalid: "請填大會日期。",
  date_not_in_year: "大會日期要在新年度那一年，請再檢查一次年度和日期。",
  schedule_invalid: "時間格式不對，請重新選擇。",
  schedule_incomplete: "目前年度的公告上線、報名開放、報名截止三個時間都要填。",
  schedule_order: "時間要依序：公告上線不能晚於報名開放，報名開放要早於報名截止。",
  not_found: "找不到這個年度，請重新整理頁面再試一次。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

/**
 * 年度管理（只有總管理員）：複製去年建立新年度、切換目前年度、列出所有年度。
 * 舊年度的資料都保留，名單可以在報名名單頁選年度查看。
 */
export default async function YearsPage({ searchParams }: PageProps<"/staff/years">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const years = await listConferences(await createClient());
  const current = years.find((year) => year.isCurrent);
  const newest = years[0];

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">年度管理</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />

      <section className={cardClass}>
        <h2 className="text-xl font-bold">複製去年建立新年度</h2>
        <p>
          複製場地、場次、課程（含名額與教室）、成對課程、午后動態、午餐、首頁內容、常見問題與自訂區塊；
          不複製報名。新年度的公告上線、報名開放、報名截止三個時間空著，設為目前年度時再填。
        </p>
        {newest ? (
          <form action={copyYear} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="從哪一年複製" required>
                <select name="sourceConferenceId" defaultValue={newest.id} required className={inputClass}>
                  {years.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.year} 年
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="新年度" hint="西元年，例如 2027。" required>
                <input
                  name="year"
                  inputMode="numeric"
                  defaultValue={newest.year + 1}
                  required
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
              <Field label="新年度的大會日期" required>
                <input
                  name="conferenceDate"
                  type="date"
                  defaultValue={nextYearDate(newest.conferenceDate)}
                  required
                  className={inputClass}
                />
              </Field>
            </div>
            <SubmitButton pendingLabel="複製中…" className={submitClass}>
              複製建立新年度
            </SubmitButton>
          </form>
        ) : (
          <p>還沒有任何年度可以複製。</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">所有年度</h2>
        {years.map((year) => (
          <YearCard key={year.id} year={year} current={current} />
        ))}
      </section>
    </main>
  );
}

function YearCard({ year, current }: { year: ConferenceYear; current: ConferenceYear | undefined }) {
  const status = year.isCurrent
    ? "目前年度（首頁正在顯示）"
    : !current || year.year > current.year
      ? "準備中，還不是目前年度"
      : "舊年度";
  const schedule = [
    ["公告上線", year.announceAt],
    ["報名開放", year.registrationOpensAt],
    ["報名截止", year.registrationClosesAt],
  ] as const;
  const missing = schedule.some(([, value]) => !value);

  return (
    <article className={cn(cardClass, year.isCurrent && "border-primary")}>
      <h3 className="text-lg font-bold">
        {year.year} 年<span className="ml-2 text-base font-normal">{status}</span>
      </h3>
      <p>大會日期：{year.conferenceDate}</p>
      <p>
        {schedule.map(([label, value]) => `${label}：${value ? formatTime(value) : "待填"}`).join("，")}
      </p>
      <Link href={`/staff/registrations?year=${year.year}`} className="self-start font-semibold underline">
        看 {year.year} 年的報名名單
      </Link>

      {!year.isCurrent && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer font-semibold">設為目前年度…</summary>
          <form action={makeCurrentYear} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="conferenceId" value={year.id} />
            <p className="rounded-lg border-2 border-destructive p-3 font-semibold">
              設定後首頁立刻改顯示 {year.year} 年，報名、查詢、修改也都改成 {year.year} 年
              {current && `；${current.year} 年變成舊年度，資料都保留，報名名單可以選年度查看`}。
            </p>
            {missing && (
              <>
                <p>這個年度的時程還沒填，請一起填好（台灣時間）。已經填了的不會改，之後可以在「首頁內容」修改。</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {!year.announceAt && (
                    <DateTimeField name="announceAt" label="公告上線" value={null} hint="首頁開始顯示日期與資訊。" />
                  )}
                  {!year.registrationOpensAt && (
                    <DateTimeField
                      name="registrationOpensAt"
                      label="報名開放"
                      value={null}
                      hint="場地與課程要在這之前準備好，之後不能新增或刪除。"
                    />
                  )}
                  {!year.registrationClosesAt && (
                    <DateTimeField
                      name="registrationClosesAt"
                      label="報名截止"
                      value={null}
                      hint="之後報名者不能再報名、修改、取消，只能查詢。"
                    />
                  )}
                </div>
              </>
            )}
            <SubmitButton pendingLabel="切換中…" className={submitClass}>
              確定設 {year.year} 年為目前年度
            </SubmitButton>
          </form>
        </details>
      )}
    </article>
  );
}

/** 新年度大會日期的預設值：同一天的明年（2 月 29 日改成 2 月 28 日）。 */
function nextYearDate(date: string): string {
  const [year, month, day] = date.split("-");
  const next = `${Number(year) + 1}-${month}-${day}`;
  return month === "02" && day === "29" ? `${Number(year) + 1}-02-28` : next;
}
