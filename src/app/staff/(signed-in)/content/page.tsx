import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { schedulePhase, type SchedulePhase } from "@/lib/conference";
import {
  getContentEditor,
  missingEnglish,
  type ContentError,
  type HomeItem,
  type HomeItemKind,
} from "@/lib/content";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../current-staff";
import { DateTimeField, Field } from "../../fields";
import { ResultMessage } from "../../result-message";
import { SubmitButton } from "../../submit-button";
import { TextPair } from "../../text-pair";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { deleteContentItem, moveContentItem, saveContentDetails, saveContentItem, saveContentSchedule } from "./actions";

export const metadata: Metadata = { title: "首頁內容" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";
const submitClass = cn(buttonVariants(), buttonClass, "self-start font-bold");

const DONE: Record<string, string> = {
  saved: "已儲存，首頁已經更新。",
  scheduled: "已儲存時程，首頁依新的時間切換狀態。",
  moved: "已調整順序。",
  deleted: "已刪除。",
};

const ERRORS: Record<ContentError, string> = {
  not_admin: "只有總管理員能編輯首頁內容。",
  date_invalid: "請填大會日期。",
  time_invalid: "時間格式不對；只填結束時間不行，結束要比開始晚。",
  line_id_invalid: "LINE ID 只能有英文字母、數字與 . - _，官方帳號以 @ 開頭。",
  schedule_invalid: "時間格式不對，請重新選擇。",
  schedule_incomplete: "目前年度的公告上線、報名開放、報名截止三個時間都要填。",
  schedule_order: "時間要依序：公告上線不能晚於報名開放，報名開放要早於報名截止。",
  opens_at_locked: "報名已經開放，報名開放時間不能再改。",
  title_required: "請填中文標題。",
  body_required: "請填中文答案。",
  button_label_required: "有按鈕網址時，請填中文按鈕文字。",
  button_url_invalid: "按鈕網址要是 https:// 開頭的完整網址，或 / 開頭的站內網址（例如 /lookup），不能有空白。",
  not_found: "找不到這一項，可能已經被刪除，或目前年度已經換了。請重新整理頁面再試一次。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

const PHASE_LABELS: Record<SchedulePhase, string> = {
  unannounced: "公告上線前（首頁只顯示「即將公布」）",
  upcoming: "報名前（顯示日期，報名按鈕還不能按）",
  open: "報名中",
  closed: "已截止（只能查詢）",
};

/**
 * 首頁內容（只有總管理員）：目前年度的時程、日期與時間、主題經文、歡迎詞、管理員 LINE、常見問題與自訂區塊。
 * 每個內容欄位中英並排，英文沒填時有缺漏警示。存檔後首頁立即反映。
 */
export default async function ContentPage({ searchParams }: PageProps<"/staff/content">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const content = await getContentEditor(await createClient());
  if (!content) {
    return (
      <main className="flex flex-col gap-8">
        <h1 className="text-2xl font-bold">首頁內容</h1>
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
      announceAt: toDate(content.announceAt),
      registrationOpensAt: toDate(content.registrationOpensAt),
      registrationClosesAt: toDate(content.registrationClosesAt),
    },
    new Date(),
  );
  const missingCount = [
    [content.themeScriptureZh, content.themeScriptureEn],
    [content.themeScriptureReferenceZh, content.themeScriptureReferenceEn],
    [content.welcomeZh, content.welcomeEn],
    ...[...content.faqs, ...content.customBlocks].flatMap((item) => [
      [item.titleZh, item.titleEn],
      [item.bodyZh, item.bodyEn],
      [item.buttonLabelZh, item.buttonLabelEn],
    ]),
  ].filter(([zh, en]) => missingEnglish(zh, en)).length;
  const conferenceId = content.conferenceId;

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">首頁內容（{content.year} 年）</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      <p>
        存檔後首頁立即更新，可以到
        <Link href="/" target="_blank" className="font-semibold underline">
          首頁
        </Link>
        確認。英文欄位沒填時，英文版會顯示中文。
      </p>
      {missingCount > 0 && (
        <p className="rounded-lg border-2 border-destructive p-3 font-semibold text-destructive">
          ⚠ 還有 {missingCount} 個欄位沒有英文，請找有「英文還沒填」提示的欄位補上。
        </p>
      )}

      <section className={cardClass}>
        <h2 className="text-xl font-bold">時程</h2>
        <p>
          首頁目前狀態：<strong>{PHASE_LABELS[phase]}</strong>。首頁到了這三個時間會自動切換狀態。時間都是台灣時間。
        </p>
        <form action={saveContentSchedule} className="flex flex-col gap-3">
          <input type="hidden" name="conferenceId" value={conferenceId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <DateTimeField name="announceAt" label="公告上線" value={content.announceAt} hint="首頁開始顯示日期與資訊。" />
            {content.registrationOpened ? (
              <div className="flex flex-col gap-1">
                <span className="font-semibold">報名開放</span>
                <p className="min-h-11 py-2">{content.registrationOpensAt && formatTime(content.registrationOpensAt)}</p>
                <span className="text-sm text-muted-foreground">報名已經開放，這個時間不能再改。</span>
              </div>
            ) : (
              <DateTimeField
                name="registrationOpensAt"
                label="報名開放"
                value={content.registrationOpensAt}
                hint="到了之後就不能再改，場地與課程也不能再新增或刪除。"
              />
            )}
            <DateTimeField
              name="registrationClosesAt"
              label="報名截止"
              value={content.registrationClosesAt}
              hint="之後報名者不能再報名、修改、取消，只能查詢。"
            />
          </div>
          <SubmitButton className={submitClass}>儲存時程</SubmitButton>
        </form>
      </section>

      <section className={cardClass}>
        <h2 className="text-xl font-bold">大會資訊</h2>
        <form action={saveContentDetails} className="flex flex-col gap-4">
          <input type="hidden" name="conferenceId" value={conferenceId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="大會日期" required>
              <input name="conferenceDate" type="date" defaultValue={content.conferenceDate} required className={inputClass} />
            </Field>
            <Field label="開始時間" hint="台灣時間；不填時首頁不顯示時間。">
              <input name="startTime" type="time" defaultValue={content.startTime} className={inputClass} />
            </Field>
            <Field label="結束時間" hint="可以不填，只顯示開始時間。">
              <input name="endTime" type="time" defaultValue={content.endTime} className={inputClass} />
            </Field>
          </div>
          <TextPair name="themeScripture" label="主題經文" zh={content.themeScriptureZh} en={content.themeScriptureEn} multiline />
          <TextPair
            name="themeScriptureReference"
            label="經文出處"
            zh={content.themeScriptureReferenceZh}
            en={content.themeScriptureReferenceEn}
          />
          <TextPair name="welcome" label="歡迎詞" zh={content.welcomeZh} en={content.welcomeEn} multiline />
          <Field label="管理員 LINE ID" hint="首頁「需要幫忙」顯示，報名者按了可以加好友。官方帳號以 @ 開頭；不填時不顯示。">
            <input name="adminLineId" defaultValue={content.adminLineId} className={cn(inputClass, "sm:max-w-xs")} />
          </Field>
          <SubmitButton className={submitClass}>儲存大會資訊</SubmitButton>
        </form>
      </section>

      <ItemList
        kind="faq"
        heading="常見問題"
        noun="問題"
        items={content.faqs}
        conferenceId={conferenceId}
        description="顯示在首頁「關於大會」裡，依這裡的順序。"
      />
      <ItemList
        kind="block"
        heading="自訂區塊"
        noun="區塊"
        items={content.customBlocks}
        conferenceId={conferenceId}
        description="臨時要公告的內容，顯示在首頁最後面，依這裡的順序。"
      />
    </main>
  );
}

/** 常見問題或自訂區塊的列表：每一項可以編輯、往前或往後移、刪除，最下面新增。 */
function ItemList({
  kind,
  heading,
  noun,
  items,
  conferenceId,
  description,
}: {
  kind: HomeItemKind;
  heading: string;
  noun: string;
  items: HomeItem[];
  conferenceId: string;
  description: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">
        {heading}（{items.length} 個）
      </h2>
      <p>{description}</p>
      {items.length === 0 && <p className="text-muted-foreground">還沒有{noun}。</p>}
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.id} className={cardClass}>
            <h3 className="text-lg font-bold">
              {index + 1}. {item.titleZh}
            </h3>
            <div className="flex flex-wrap gap-3">
              {index > 0 && <MoveButton kind={kind} id={item.id} direction="up" />}
              {index < items.length - 1 && <MoveButton kind={kind} id={item.id} direction="down" />}
            </div>
            <details>
              <summary className="cursor-pointer font-semibold">編輯{noun}</summary>
              <div className="mt-3">
                <ItemForm kind={kind} conferenceId={conferenceId} item={item} submitLabel={`儲存${noun}`} />
              </div>
            </details>
            <details>
              <summary className="cursor-pointer font-semibold text-destructive">刪除{noun}</summary>
              <form action={deleteContentItem} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={item.id} />
                <p>確定要刪除這個{noun}嗎？首頁會立即拿掉，不能復原。</p>
                <SubmitButton
                  className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}
                >
                  確定刪除
                </SubmitButton>
              </form>
            </details>
          </li>
        ))}
      </ol>
      <details className={cardClass}>
        <summary className="cursor-pointer text-lg font-bold">新增{noun}</summary>
        <div className="mt-3">
          <ItemForm kind={kind} conferenceId={conferenceId} submitLabel={`新增${noun}`} />
        </div>
      </details>
    </section>
  );
}

function MoveButton({ kind, id, direction }: { kind: HomeItemKind; id: string; direction: "up" | "down" }) {
  return (
    <form action={moveContentItem}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <SubmitButton className={cn(buttonVariants({ variant: "outline" }), buttonClass)}>
        {direction === "up" ? "↑ 往前移" : "↓ 往後移"}
      </SubmitButton>
    </form>
  );
}

function ItemForm({
  kind,
  conferenceId,
  item,
  submitLabel,
}: {
  kind: HomeItemKind;
  conferenceId: string;
  item?: HomeItem;
  submitLabel: string;
}) {
  return (
    <form action={saveContentItem} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <TextPair name="title" label={kind === "faq" ? "問題" : "標題"} zh={item?.titleZh} en={item?.titleEn} required />
      <TextPair
        name="body"
        label={kind === "faq" ? "答案" : "內文"}
        zh={item?.bodyZh}
        en={item?.bodyEn}
        required={kind === "faq"}
        multiline
      />
      {kind === "block" && (
        <>
          <TextPair name="buttonLabel" label="按鈕文字" zh={item?.buttonLabelZh} en={item?.buttonLabelEn} />
          <Field label="按鈕網址" hint="不要按鈕就留空白。https:// 開頭的完整網址，或 / 開頭的站內網址，例如 /lookup。">
            <input name="buttonUrl" defaultValue={item?.buttonUrl} className={inputClass} />
          </Field>
        </>
      )}
      <SubmitButton className={submitClass}>{submitLabel}</SubmitButton>
    </form>
  );
}
