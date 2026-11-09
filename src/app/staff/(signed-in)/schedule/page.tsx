import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { schedulePhase, type SchedulePhase } from "@/lib/conference";
import { getScheduleEditor, type ScheduleError } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../current-staff";
import { DateTimeField, Field } from "../../fields";
import { PreviewLinks } from "../../preview-links";
import { ResultMessage } from "../../result-message";
import { SubmitButton } from "../../submit-button";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { saveScheduleDetails, saveScheduleTimes } from "./actions";

export const metadata: Metadata = { title: "大會時程" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";
const submitClass = cn(buttonVariants(), buttonClass, "self-start font-bold");

const DONE: Record<string, string> = {
  saved: "已儲存，報名首頁已經更新。",
  scheduled: "已儲存時程，報名首頁依新的時間切換報名狀態。",
};

const ERRORS: Record<ScheduleError, string> = {
  not_admin: "只有總管理員能編輯大會時程。",
  date_invalid: "請填大會日期。",
  time_invalid: "時間格式不對；只填結束時間不行，結束要比開始晚。",
  schedule_invalid: "時間格式不對，請重新選擇。",
  schedule_incomplete: "目前年度的公告上線、報名開放、報名截止三個時間都要填。",
  schedule_order: "時間要依序：公告上線不能晚於報名開放，報名開放要早於報名截止。",
  opens_at_locked: "報名已經開放，報名開放時間不能再改。",
  not_found: "找不到目前年度，可能目前年度剛換了。請重新整理頁面再試一次。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

const PHASE_LABELS: Record<SchedulePhase, string> = {
  unannounced: "公告上線前（報名首頁只顯示「即將公布」）",
  upcoming: "報名前（顯示日期，還沒有報名按鈕）",
  open: "報名中",
  closed: "已截止（只能查詢）",
};

/**
 * 大會時程（只有總管理員）：目前年度的公告上線、報名開放、報名截止，以及大會日期與開始、結束時間。
 * 報名入口頁與報名表都依這些時間；存檔後立即反映。原本在「首頁內容」，首頁移到大會網站後只留這兩區（ADR 0012）。
 */
export default async function SchedulePage({ searchParams }: PageProps<"/staff/schedule">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const schedule = await getScheduleEditor(await createClient());
  if (!schedule) {
    return (
      <main className="flex flex-col gap-8">
        <h1 className="text-2xl font-bold">大會時程</h1>
        <p>
          還沒有目前年度，請先到
          <Link href="/staff/years" className="font-semibold underline">
            年度管理
          </Link>
          設定目前年度。
        </p>
      </main>
    );
  }

  const toDate = (iso: string | null) => (iso ? new Date(iso) : null);
  const phase = schedulePhase(
    {
      announceAt: toDate(schedule.announceAt),
      registrationOpensAt: toDate(schedule.registrationOpensAt),
      registrationClosesAt: toDate(schedule.registrationClosesAt),
    },
    new Date(),
  );
  const conferenceId = schedule.conferenceId;

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">大會時程（{schedule.year} 年）</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      <p>存檔後報名首頁立即更新；公告上線前訪客還看不到，請用下面的「預覽報名首頁」。</p>
      <PreviewLinks />

      <section className={cardClass}>
        <h2 className="text-xl font-bold">時程</h2>
        <p>
          報名首頁目前狀態：<strong>{PHASE_LABELS[phase]}</strong>。到了這三個時間會自動切換。時間都是台灣時間。
        </p>
        <form action={saveScheduleTimes} className="flex flex-col gap-3">
          <input type="hidden" name="conferenceId" value={conferenceId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <DateTimeField
              name="announceAt"
              label="公告上線"
              value={schedule.announceAt}
              hint="報名首頁開始顯示大會日期與報名狀態。"
            />
            {schedule.registrationOpened ? (
              <div className="flex flex-col gap-1">
                <span className="font-semibold">報名開放</span>
                <p className="min-h-11 py-2">{schedule.registrationOpensAt && formatTime(schedule.registrationOpensAt)}</p>
                <span className="text-sm text-muted-foreground">報名已經開放，這個時間不能再改。</span>
              </div>
            ) : (
              <DateTimeField
                name="registrationOpensAt"
                label="報名開放"
                value={schedule.registrationOpensAt}
                hint="到了之後就不能再改，場地與課程也不能再新增或刪除。"
              />
            )}
            <DateTimeField
              name="registrationClosesAt"
              label="報名截止"
              value={schedule.registrationClosesAt}
              hint="之後報名者不能再報名、修改、取消，只能查詢。"
            />
          </div>
          <SubmitButton className={submitClass}>儲存時程</SubmitButton>
        </form>
      </section>

      <section className={cardClass}>
        <h2 className="text-xl font-bold">大會日期與時間</h2>
        <form action={saveScheduleDetails} className="flex flex-col gap-4">
          <input type="hidden" name="conferenceId" value={conferenceId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="大會日期" required>
              <input name="conferenceDate" type="date" defaultValue={schedule.conferenceDate} required className={inputClass} />
            </Field>
            <Field label="開始時間" hint="台灣時間；不填時報名首頁不顯示時間。">
              <input name="startTime" type="time" defaultValue={schedule.startTime} className={inputClass} />
            </Field>
            <Field label="結束時間" hint="可以不填，只顯示開始時間。">
              <input name="endTime" type="time" defaultValue={schedule.endTime} className={inputClass} />
            </Field>
          </div>
          <SubmitButton className={submitClass}>儲存日期與時間</SubmitButton>
        </form>
      </section>
    </main>
  );
}
