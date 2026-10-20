import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getAgendaEditor, type AgendaEditor, type AgendaError, type AgendaItem } from "@/lib/agenda";
import { missingEnglish } from "@/lib/content";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../current-staff";
import { Field } from "../../fields";
import { ResultMessage } from "../../result-message";
import { SubmitButton } from "../../submit-button";
import { TextPair } from "../../text-pair";
import { alertClass, buttonClass, inputClass } from "../../ui";
import { deleteAgendaItemAction, moveAgendaItemAction, saveAgendaItemAction, saveAgendaVenueAction } from "./actions";

export const metadata: Metadata = { title: "大會程序" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";
const submitClass = cn(buttonVariants(), buttonClass, "self-start font-bold");
// 子項目表單上多留幾個空格，新增子項目不用另外按按鈕。
const BLANK_PARTS = 2;

const DONE: Record<string, string> = {
  saved: "已儲存。",
  moved: "已調整順序。",
  deleted: "已刪除。",
};

const ERRORS: Record<AgendaError, string> = {
  not_admin: "只有總管理員能編輯大會程序。",
  name_required: "請填中文名稱。",
  time_invalid: "請填開始與結束時間，結束要比開始晚。",
  part_name_required: "有填英文的子項目，也要填中文。",
  highlight_invalid: "選的大會特色找不到，可能剛被刪除。請重新整理頁面再選一次。",
  session_taken: "這個場次已經接到另一列了。一個場次只能接到一列，請先把另一列的場次改掉。",
  session_invalid: "選的場次找不到，可能剛被刪除。請重新整理頁面再選一次。",
  not_found: "找不到這一列，可能已經被刪除，或目前年度已經換了。請重新整理頁面再試一次。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

/**
 * 大會程序（只有總管理員）：目前年度一整天的時間軸。每一列各場地共用時間、名稱、子項目；
 * 地點、補充說明、對應的場次分場地設定。報名開放後照樣能改，都是說明文字，不影響報名。
 */
export default async function AgendaPage({ searchParams }: PageProps<"/staff/agenda">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const agenda = await getAgendaEditor(await createClient());
  if (!agenda) {
    return (
      <main className="flex flex-col gap-8">
        <h1 className="text-2xl font-bold">大會程序</h1>
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

  const missingCount = agenda.items
    .flatMap((item) => [
      [item.nameZh, item.nameEn],
      ...item.parts.map((part) => [part.nameZh, part.nameEn]),
      ...Object.values(item.venues).flatMap((setting) => [
        [setting.placeZh, setting.placeEn],
        [setting.noteZh, setting.noteEn],
      ]),
    ])
    .filter(([zh, en]) => missingEnglish(zh, en)).length;

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">大會程序（{agenda.year} 年）</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      <p>
        大會當天一整天的時間軸，新首頁上線後顯示在首頁「大會程序」。每一列三間教堂共用時間、名稱與子項目；
        地點、補充說明與對應的場次分教堂設定。接了場次的列，首頁會在下面列出那個場次的課程。
        報名開放後也可以改。英文欄位沒填時，英文版會顯示中文。
      </p>
      {missingCount > 0 && (
        <p className={alertClass}>⚠ 還有 {missingCount} 個欄位沒有英文，請找有「英文還沒填」提示的欄位補上。</p>
      )}
      {agenda.unplacedSessions.length > 0 && (
        <div className={alertClass}>
          <p>⚠ 這些場次還沒放進大會程序，首頁會看不到它們的課程：</p>
          <ul className="list-disc pl-6 font-normal">
            {agenda.unplacedSessions.map((session, index) => (
              <li key={index}>
                {session.venueNameZh}｜{session.sessionNameZh}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">每一列（{agenda.items.length} 列）</h2>
        {agenda.items.length === 0 && <p className="text-muted-foreground">還沒有任何一列。</p>}
        <ol className="flex flex-col gap-3">
          {agenda.items.map((item, index) => (
            <AgendaItemCard key={item.id} item={item} agenda={agenda} first={index === 0} last={index === agenda.items.length - 1} />
          ))}
        </ol>
        <details className={cardClass}>
          <summary className="cursor-pointer text-lg font-bold">新增一列</summary>
          <div className="mt-3">
            <AgendaItemForm agenda={agenda} submitLabel="新增" />
          </div>
        </details>
      </section>
    </main>
  );
}

function AgendaItemCard({ item, agenda, first, last }: { item: AgendaItem; agenda: AgendaEditor; first: boolean; last: boolean }) {
  const sessionName = new Map(agenda.venues.flatMap((venue) => venue.sessions.map((session) => [session.id, session.nameZh])));
  return (
    <li className={cardClass}>
      <h3 className="text-lg font-bold">
        {item.startTime}–{item.endTime} {item.nameZh}
      </h3>
      {item.parts.length > 0 && <p>子項目：{item.parts.map((part) => part.nameZh).join("、")}</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {agenda.venues.map((venue) => {
          const setting = item.venues[venue.id];
          const details = [
            setting.placeZh && `地點 ${setting.placeZh}`,
            setting.sessionId && `場次 ${sessionName.get(setting.sessionId)}`,
            setting.noteZh && `補充說明 ${setting.noteZh}`,
          ].filter(Boolean);
          return (
            <li key={venue.id}>
              <span className="font-semibold">{venue.nameZh}：</span>
              {details.length > 0 ? details.join("・") : <span className="text-muted-foreground">沒有設定</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3">
        {!first && <MoveButton id={item.id} direction="up" />}
        {!last && <MoveButton id={item.id} direction="down" />}
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">編輯時間、名稱與子項目</summary>
        <div className="mt-3">
          <AgendaItemForm agenda={agenda} item={item} submitLabel="儲存" />
        </div>
      </details>
      {agenda.venues.map((venue) => (
        <details key={venue.id}>
          <summary className="cursor-pointer font-semibold">設定{venue.nameZh}</summary>
          <div className="mt-3">
            <AgendaVenueForm item={item} venue={venue} />
          </div>
        </details>
      ))}
      <details>
        <summary className="cursor-pointer font-semibold text-destructive">刪除這一列</summary>
        <form action={deleteAgendaItemAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="id" value={item.id} />
          <p>確定要刪除「{item.nameZh}」嗎？各教堂的設定一起刪除，不能復原。場次與課程不會刪除。</p>
          <SubmitButton className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}>
            確定刪除
          </SubmitButton>
        </form>
      </details>
    </li>
  );
}

function MoveButton({ id, direction }: { id: string; direction: "up" | "down" }) {
  return (
    <form action={moveAgendaItemAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <SubmitButton className={cn(buttonVariants({ variant: "outline" }), buttonClass)}>
        {direction === "up" ? "↑ 往前移" : "↓ 往後移"}
      </SubmitButton>
    </form>
  );
}

/** 一列的時間、名稱與子項目。子項目列出已有的，再多留幾個空格；清空一個子項目就是刪掉它。 */
function AgendaItemForm({ agenda, item, submitLabel }: { agenda: AgendaEditor; item?: AgendaItem; submitLabel: string }) {
  const parts = [...(item?.parts ?? []), ...Array.from({ length: BLANK_PARTS }, () => null)];
  return (
    <form action={saveAgendaItemAction} className="flex flex-col gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="conferenceId" value={agenda.conferenceId} />
      <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
        <Field label="開始時間" required>
          <input name="startTime" type="time" defaultValue={item?.startTime} required className={inputClass} />
        </Field>
        <Field label="結束時間" required>
          <input name="endTime" type="time" defaultValue={item?.endTime} required className={inputClass} />
        </Field>
      </div>
      <TextPair name="name" label="名稱" zh={item?.nameZh} en={item?.nameEn} required />
      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold">子項目</legend>
        <p className="text-sm text-muted-foreground">
          例如開幕式的「即席唱詩班」「領袖演講」，依這裡的順序顯示。不要的子項目把中英文都清空。
          可以連到一項大會特色，首頁上點了就到它的介紹頁。
        </p>
        {parts.map((part, index) => (
          <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <Field label={`第 ${index + 1} 項（中文）`}>
              <input name="partNameZh" defaultValue={part?.nameZh} className={inputClass} />
            </Field>
            <Field label={`第 ${index + 1} 項（英文）`}>
              <input name="partNameEn" defaultValue={part?.nameEn} className={inputClass} />
              {part && missingEnglish(part.nameZh, part.nameEn) && (
                <span className="text-sm font-semibold text-destructive">⚠ 英文還沒填，英文版會顯示中文。</span>
              )}
            </Field>
            <Field label="連到大會特色">
              <select name="partHighlightId" defaultValue={part?.highlightId ?? ""} className={inputClass}>
                <option value="">不連</option>
                {agenda.highlights.map((highlight) => (
                  <option key={highlight.id} value={highlight.id}>
                    {highlight.nameZh}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ))}
      </fieldset>
      <SubmitButton className={submitClass}>{submitLabel}</SubmitButton>
    </form>
  );
}

/** 一列在一間教堂的地點、補充說明、對應場次。 */
function AgendaVenueForm({ item, venue }: { item: AgendaItem; venue: AgendaEditor["venues"][number] }) {
  const setting = item.venues[venue.id];
  return (
    <form action={saveAgendaVenueAction} className="flex flex-col gap-3">
      <input type="hidden" name="agendaItemId" value={item.id} />
      <input type="hidden" name="venueId" value={venue.id} />
      <TextPair name="place" label="地點" zh={setting.placeZh} en={setting.placeEn} />
      <TextPair name="note" label="補充說明" zh={setting.noteZh} en={setting.noteEn} multiline />
      <Field
        label="對應的場次"
        hint="首頁會在這一列下面列出這個場次的課程。一個場次只能接到一列，例如金華的午后動態接到「公益服務說明」。"
      >
        <select name="sessionId" defaultValue={setting.sessionId ?? ""} className={cn(inputClass, "sm:max-w-md")}>
          <option value="">沒有</option>
          {venue.sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.nameZh}
            </option>
          ))}
        </select>
      </Field>
      <SubmitButton className={submitClass}>儲存{venue.nameZh}的設定</SubmitButton>
    </form>
  );
}
