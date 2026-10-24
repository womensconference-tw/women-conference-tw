import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { schedulePhase, type SchedulePhase } from "@/lib/conference";
import {
  getContentEditor,
  missingEnglish,
  type ContentEditor,
  type ContentError,
  type HighlightItem,
  type HighlightPersonItem,
  type HomeItem,
  type HomeItemKind,
} from "@/lib/content";
import { getStakeDirectory } from "@/lib/stakes";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../current-staff";
import { DateTimeField, Field } from "../../fields";
import { RichTextEditor } from "../../rich-text-editor";
import { PreviewLinks } from "../../preview-links";
import { ResultMessage } from "../../result-message";
import { SubmitButton } from "../../submit-button";
import { TextPair } from "../../text-pair";
import { buttonClass, formatTime, inputClass } from "../../ui";
import { HERO_SLOTS, type HeroError, type HeroSlot } from "@/lib/hero";
import { PERSON_SECTIONS, type PageTemplate, type PersonSection } from "@/lib/home-content";
import {
  deleteContentItem,
  deleteHighlightPersonAction,
  moveHighlightPersonAction,
  moveContentItem,
  removeHeroImageAction,
  saveContentDetails,
  saveContentItem,
  saveContentSchedule,
  saveHeroAltAction,
  saveHighlightPersonAction,
  saveHighlightVenueAction,
} from "./actions";
import { HeroUpload } from "./hero-upload";
import { PersonPhotoField } from "./person-photo-field";
import { UnitFields, type UnitStake } from "./unit-fields";

export const metadata: Metadata = { title: "首頁內容" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";
const submitClass = cn(buttonVariants(), buttonClass, "self-start font-bold");

const DONE: Record<string, string> = {
  saved: "已儲存，首頁已經更新。",
  venueSaved: "已儲存教堂分頁，介紹頁已經更新。",
  personSaved: "已儲存人物，介紹頁已經更新。",
  scheduled: "已儲存時程，首頁依新的時間切換狀態。",
  moved: "已調整順序。",
  deleted: "已刪除。",
  heroUploaded: "已上傳，首頁已經換成這張圖。",
  heroRemoved: "已刪除這張圖。",
};

const ERRORS: Record<ContentError | HeroError, string> = {
  not_admin: "只有總管理員能編輯首頁內容。",
  date_invalid: "請填大會日期。",
  time_invalid: "時間格式不對；只填結束時間不行，結束要比開始晚。",
  line_id_invalid: "LINE ID 只能有英文字母、數字與 . - _，官方帳號以 @ 開頭。",
  schedule_invalid: "時間格式不對，請重新選擇。",
  schedule_incomplete: "目前年度的公告上線、報名開放、報名截止三個時間都要填。",
  schedule_order: "時間要依序：公告上線不能晚於報名開放，報名開放要早於報名截止。",
  opens_at_locked: "報名已經開放，報名開放時間不能再改。",
  title_required: "請填中文標題（大會特色是名稱）。",
  body_required: "請填中文答案。",
  button_label_required: "有按鈕網址時，請填中文按鈕文字。",
  button_url_invalid: "按鈕網址要是 https:// 開頭的完整網址，或 / 開頭的站內網址（例如 /lookup），不能有空白。",
  person_name_required: "請填中文姓名。",
  file_type: "只收 JPG、PNG、WebP 格式的圖片。",
  file_too_large: "圖片超過 5 MB，請請美編組另存小一點的檔案（例如存成 JPG）。",
  alt_required: "有主視覺圖片時，中文圖片說明一定要填。",
  upload_failed: "圖片沒有上傳成功，請檢查網路後再試一次。格式要是 JPG、PNG、WebP，5 MB 以內。",
  upload_unknown: "連線中斷，不確定圖片有沒有換好。請重新整理頁面，看看這個位置現在是哪一張圖；不是新的那張再上傳一次。",
  hero_changed: "這個位置的圖剛被換過（可能是另一位總管理員），這次沒有改。請看看現在是哪一張，再決定要不要換或刪除。",
  not_found: "找不到這一項，可能已經被刪除，或目前年度已經換了。請重新整理頁面再試一次。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

const TITLE_LABELS: Record<HomeItemKind, string> = { faq: "問題", block: "標題", highlight: "名稱" };

/** 介紹頁的人物卡片版型（範本 A，設計稿 docs/design/template-a-cards.dc.html）。 */
const TEMPLATE_LABELS: Record<PageTemplate, string> = {
  corner: "角落課程",
  spiritual: "靈性課程",
  honor: "向貴賓致敬",
  missionary: "與年長夫婦傳教士有約",
  exhibit: "靜態展示",
};

/**
 * 沒有對應課程時自己打的名稱：角落課程顯示在卡片上，靈性課程是個人介紹頁的標題，靜態展示是作品名稱。
 * 向貴賓致敬、傳教士的個人介紹頁標題是姓名，不用填（null）。
 */
const PERSON_TITLE_LABELS: Record<PageTemplate, { label: string; hint: string } | null> = {
  corner: { label: "課程名稱", hint: "沒有對應課程時才要填。卡片上的按鈕與個人介紹頁的標題就是課程名稱。" },
  spiritual: { label: "課程名稱", hint: "沒有對應課程時才要填。個人介紹頁的標題就是課程名稱（卡片上不顯示）。" },
  honor: null,
  missionary: null,
  exhibit: { label: "作品名稱", hint: "卡片上的按鈕與個人介紹頁的標題就是作品名稱。" },
};

/** 個人介紹頁各段在後台的名稱（和前台 messages 的 activity 一致）。 */
const PERSON_SECTION_LABELS: Record<PersonSection, (template: PageTemplate) => string> = {
  bio: (template) => (template === "honor" ? "貴賓介紹" : "講師介紹"),
  summary: () => "課程簡介",
  outline: () => "課程大綱",
};

const HERO_LABELS: Record<HeroSlot, { label: string; ratio: string }> = {
  mobileZh: { label: "手機版（中文）", ratio: "4:5，建議 1080×1350。" },
  mobileEn: { label: "手機版（英文）", ratio: "4:5，建議 1080×1350。" },
  desktopZh: { label: "電腦版（中文）", ratio: "3:1，建議 2400×800。" },
  desktopEn: { label: "電腦版（英文）", ratio: "3:1，建議 2400×800。" },
};

const PHASE_LABELS: Record<SchedulePhase, string> = {
  unannounced: "公告上線前（首頁只顯示「即將公布」）",
  upcoming: "報名前（顯示日期，報名按鈕還不能按）",
  open: "報名中",
  closed: "已截止（只能查詢）",
};

/**
 * 首頁內容（只有總管理員）：目前年度的時程、主視覺、日期與時間、主題經文、歡迎詞與署名、管理員 LINE、
 * 常見問題、自訂區塊與大會特色。
 * 每個內容欄位中英並排，英文沒填時有缺漏警示。存檔後首頁立即反映。
 */
export default async function ContentPage({ searchParams }: PageProps<"/staff/content">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const supabase = await createClient();
  const [content, directory] = await Promise.all([getContentEditor(supabase), getStakeDirectory(supabase)]);
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
    [content.welcomeSignatureZh, content.welcomeSignatureEn],
    [content.heroAltZh, content.heroAltEn],
    ...[...content.faqs, ...content.customBlocks, ...content.highlights].flatMap((item) => [
      [item.titleZh, item.titleEn],
      [item.bodyZh, item.bodyEn],
      [item.buttonLabelZh, item.buttonLabelEn],
      [item.summaryZh, item.summaryEn],
    ]),
    ...content.highlights.flatMap((item) => item.venues.map((venue) => [venue.bodyZh, venue.bodyEn])),
    // 人物版型的欄位只在選了版型時顯示，沒選的不必提醒。
    ...content.highlights
      .filter((item) => item.pageTemplate)
      .flatMap((item) => [
        [item.subtitleZh, item.subtitleEn],
        [item.leadQuoteZh, item.leadQuoteEn],
        [item.leadQuoteSourceZh, item.leadQuoteSourceEn],
        ...item.people.flatMap((person) => [
          [person.serviceAreaZh, person.serviceAreaEn],
          [person.nameZh, person.nameEn],
          [person.courseTitleZh, person.courseTitleEn],
          [person.bioZh, person.bioEn],
          [person.summaryZh, person.summaryEn],
          [person.outlineZh, person.outlineEn],
        ]),
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
        確認；公告上線前首頁還看不到，請用下面的「預覽首頁」。英文欄位沒填時，英文版會顯示中文。
      </p>
      <PreviewLinks />
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

      <HeroSection content={content} />

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
          <TextPair
            name="welcomeSignature"
            label="歡迎詞署名"
            zh={content.welcomeSignatureZh}
            en={content.welcomeSignatureEn}
          />
          <Field label="管理員 LINE ID" hint="首頁「需要幫忙」顯示，報名者按了可以加好友。官方帳號以 @ 開頭；不填時不顯示。">
            <input name="adminLineId" defaultValue={content.adminLineId} className={cn(inputClass, "sm:max-w-xs")} />
          </Field>
          <SubmitButton className={submitClass}>儲存大會資訊</SubmitButton>
        </form>
      </section>

      <ItemList
        kind="highlight"
        heading="大會有什麼（大會特色）"
        noun="大會特色"
        items={content.highlights}
        conferenceId={conferenceId}
        choices={{
          stakes: directory.stakes.map((stake) => ({
            id: stake.id,
            // 停用的仍列出（人物原本選的要能留著），標示出來免得新選到。
            name: stake.isActive ? stake.nameZh : `${stake.nameZh}（已停用）`,
            active: stake.isActive,
            region: stake.region,
            wards: stake.wards.map((ward) => ({
              id: ward.id,
              name: ward.isActive ? ward.nameZh : `${ward.nameZh}（已停用）`,
              active: ward.isActive,
            })),
          })),
          venues: content.venues,
          courses: content.courses,
        }}
        description="首頁「大會有什麼」的卡片，依這裡的順序。介紹頁有內容（介紹內容、教堂分頁或有課程分在這一類）的卡片可以點進介紹頁；都沒有的只顯示名稱和一句話，不能點。角落課程、靈性課程、向貴賓致敬、與年長夫婦傳教士有約、靜態展示請選對應的介紹頁版型，介紹頁會改成依教堂分組的人物卡片（介紹內容或人物有一個就能點）。"
      />
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

/**
 * 主視覺（#81）：圖片說明與四張圖。有圖時中文圖片說明必填，所以要先存好說明才能上傳。
 * 圖片由瀏覽器直接上傳（HeroUpload），刪圖走一般的伺服器動作。
 */
function HeroSection({ content }: { content: NonNullable<Awaited<ReturnType<typeof getContentEditor>>> }) {
  const hasAlt = content.heroAltZh.trim() !== "";
  return (
    <section className={cardClass}>
      <h2 className="text-xl font-bold">主視覺</h2>
      <p>
        美編組每年做的大圖，顯示在首頁最上面。手機寬度用手機版、電腦寬度用電腦版；
        英文版沒有英文圖就用中文圖，電腦版沒有就用手機版。沒有手機版時，手機上改用文字顯示主題經文（不讓手機下載電腦版的大圖）。
      </p>
      <form action={saveHeroAltAction} className="flex flex-col gap-3">
        <input type="hidden" name="conferenceId" value={content.conferenceId} />
        <TextPair name="heroAlt" label="圖片說明" zh={content.heroAltZh} en={content.heroAltEn} multiline />
        <span className="text-sm text-muted-foreground">
          給看不到圖的人（螢幕閱讀器）聽的文字，寫出圖裡的字，例如「2026 台灣姐妹大會主視覺：你要把你的重擔卸給耶和華……詩篇
          55:22」。有圖時中文一定要填。
        </span>
        <SubmitButton className={submitClass}>儲存圖片說明</SubmitButton>
      </form>
      <div className="grid gap-4 sm:grid-cols-2">
        {HERO_SLOTS.map((slot) => {
          const image = content.heroImages[slot];
          const { label, ratio } = HERO_LABELS[slot];
          return (
            <div key={slot} className="flex flex-col gap-3 rounded-lg border p-3">
              <h3 className="text-lg font-bold">{label}</h3>
              {image ? (
                // 存放空間的公開網址，不經過 Next.js 的圖片最佳化（後台只是預覽）。
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt={`目前的${label}主視覺`} className="max-h-60 self-start rounded border object-contain" />
              ) : (
                <p className="text-muted-foreground">還沒有圖。</p>
              )}
              {hasAlt ? (
                <HeroUpload
                  conferenceId={content.conferenceId}
                  slot={slot}
                  label={image ? "換一張圖" : "上傳圖片"}
                  ratioHint={ratio}
                />
              ) : (
                <p className="font-semibold">請先填好上面的中文圖片說明並儲存，才能上傳圖片。</p>
              )}
              {image && (
                <details>
                  <summary className="cursor-pointer font-semibold text-destructive">刪除這張圖</summary>
                  <form action={removeHeroImageAction} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="conferenceId" value={content.conferenceId} />
                    <input type="hidden" name="slot" value={slot} />
                    <input type="hidden" name="path" value={image.path} />
                    <p>確定要刪除{label}的主視覺嗎？首頁會立即拿掉，不能復原。</p>
                    <SubmitButton
                      className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}
                    >
                      確定刪除
                    </SubmitButton>
                  </form>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
  choices = { stakes: [], venues: [], courses: [] },
}: {
  kind: HomeItemKind;
  heading: string;
  noun: string;
  items: (HomeItem | HighlightItem)[];
  conferenceId: string;
  description: string;
  /** 大會特色的人物可選的支聯會與支會（含停用的）、教堂與課程。 */
  choices?: PersonChoices;
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
              {"pageTemplate" in item && item.pageTemplate && (
                <span className="font-normal text-muted-foreground">（版型：{TEMPLATE_LABELS[item.pageTemplate]}）</span>
              )}
            </h3>
            {"linkable" in item &&
              (item.linkable ? (
                <Link href={`/preview/highlights/${item.id}`} target="_blank" className="self-start font-semibold underline">
                  預覽介紹頁
                </Link>
              ) : (
                <p className="text-muted-foreground">介紹頁還沒有內容，首頁的卡片不能點。</p>
              ))}
            <div className="flex flex-wrap gap-3">
              {index > 0 && <MoveButton kind={kind} id={item.id} direction="up" />}
              {index < items.length - 1 && <MoveButton kind={kind} id={item.id} direction="down" />}
            </div>
            <details>
              <summary className="cursor-pointer font-semibold">編輯{noun}</summary>
              <div className="mt-3">
                <ItemForm
                  kind={kind}
                  conferenceId={conferenceId}
                  item={item}
                  // 大會特色的編輯區都在同一頁展開，寫出是哪一項（#102）。
                  submitLabel={kind === "highlight" ? `儲存「${item.titleZh}」項目` : `儲存${noun}`}
                />
              </div>
            </details>
            {"venues" in item &&
              (item.pageTemplate ? (
                <HighlightPeopleForms item={item} template={item.pageTemplate} conferenceId={conferenceId} choices={choices} />
              ) : (
                <HighlightVenueForms item={item} conferenceId={conferenceId} />
              ))}
            <details>
              <summary className="cursor-pointer font-semibold text-destructive">刪除{noun}</summary>
              <form action={deleteContentItem} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={item.id} />
                <p>確定要刪除這個{noun}嗎？首頁會立即拿掉，不能復原。</p>
                {item.courseCount > 0 && (
                  <p className="font-semibold">
                    有 {item.courseCount} 門課分在這一類，刪除後這些課變成沒有分類（課程本身不會刪除）。
                  </p>
                )}
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

/**
 * 大會特色的教堂分頁（#100）：每間教堂一個表單。介紹頁只顯示有說明或有課程的教堂；
 * 分在這一類的課程由介紹頁自動列出，這裡只顯示有幾門。
 */
function HighlightVenueForms({ item, conferenceId }: { item: HighlightItem; conferenceId: string }) {
  if (item.venues.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer font-semibold">各教堂分頁</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p>
          介紹頁在介紹內容下面分教堂說明，例如各教堂的地點、時間、要帶什麼。只有寫了說明、或有課程分在這一類的教堂才會出現分頁。
        </p>
        {item.venues.map((venue) => (
          <details key={venue.venueId} className="rounded-lg border p-3">
            <summary className="cursor-pointer font-semibold">
              {venue.venueName}
              {venue.bodyZh.trim() === "" && venue.courseCount === 0 && "（沒有分頁）"}
            </summary>
            <form action={saveHighlightVenueAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="highlightId" value={item.id} />
              <input type="hidden" name="venueId" value={venue.venueId} />
              <p className="text-muted-foreground">
                {venue.courseCount > 0
                  ? `這間教堂有 ${venue.courseCount} 門課分在「${item.titleZh}」，會自動列在說明下面，不用另外寫。`
                  : `這間教堂沒有課程分在「${item.titleZh}」。`}
              </p>
              <RichTextEditor
                name="bodyZh"
                label={`${venue.venueName}的說明（中文）`}
                hint="中英都清空後儲存，就拿掉這間教堂的說明。"
                defaultValue={venue.bodyZh}
                saveLabel="儲存這間教堂"
                imageFolder={conferenceId}
              />
              <RichTextEditor
                name="bodyEn"
                label={`${venue.venueName}的說明（英文）`}
                hint="不寫的話英文版顯示中文。"
                defaultValue={venue.bodyEn}
                saveLabel="儲存這間教堂"
                imageFolder={conferenceId}
              />
              {missingEnglish(venue.bodyZh, venue.bodyEn) && (
                <span className="text-sm font-semibold text-destructive">⚠ 這間教堂的說明英文還沒填，英文版會顯示中文。</span>
              )}
              <SubmitButton className={submitClass}>儲存這間教堂</SubmitButton>
            </form>
          </details>
        ))}
      </div>
    </details>
  );
}

/** 人物表單可選的支聯會與支會（含停用的）、目前年度的教堂與課程。 */
type PersonChoices = {
  stakes: DirectoryUnit[];
  venues: ContentEditor["venues"];
  courses: ContentEditor["courses"];
};

/**
 * 人物卡片版型介紹頁的人物：每一位可以編輯、往前或往後移、刪除，最下面新增。介紹頁依教堂分組，組內照這裡的順序。
 * 選了版型時介紹頁不用各教堂分頁，所以不顯示（已寫的說明還留著，改回一般介紹頁時會再出現）。
 */
function HighlightPeopleForms({
  item,
  template,
  conferenceId,
  choices,
}: {
  item: HighlightItem;
  template: PageTemplate;
  conferenceId: string;
  choices: PersonChoices;
}) {
  const venueName = (person: HighlightPersonItem) => {
    const courseVenue = choices.courses.find((course) => course.id === person.courseId)?.label.split("・")[0];
    return courseVenue ?? choices.venues.find((venue) => venue.id === person.venueId)?.name ?? "";
  };
  return (
    <details>
      <summary className="cursor-pointer font-semibold">人物（{item.people.length} 位）</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p>
          介紹頁下面的人物卡片：照片、支聯會與支會、姓名，依教堂分組，組內依這裡的順序。有寫個人介紹頁的文字，卡片才有按鈕連到個人介紹頁。
        </p>
        <ol className="flex flex-col gap-3">
          {item.people.map((person, index) => (
            <li key={person.id} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-3">
                {person.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={person.photo.url}
                    alt=""
                    className="size-14 rounded-full object-cover"
                    style={{ objectPosition: `50% ${person.photoFocus}%` }}
                  />
                )}
                <span className="font-semibold">
                  {index + 1}. {person.nameZh}
                </span>
                {[venueName(person), person.stakeName, person.wardName].some(Boolean) && (
                  <span className="text-muted-foreground">
                    {[venueName(person), person.stakeName, person.wardName].filter(Boolean).join("・")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                {index > 0 && <MovePersonButton id={person.id} direction="up" />}
                {index < item.people.length - 1 && <MovePersonButton id={person.id} direction="down" />}
              </div>
              <details>
                <summary className="cursor-pointer font-semibold">編輯「{person.nameZh}」</summary>
                <div className="mt-3">
                  <PersonForm item={item} template={template} conferenceId={conferenceId} choices={choices} person={person} />
                </div>
              </details>
              <details>
                <summary className="cursor-pointer font-semibold text-destructive">刪除「{person.nameZh}」</summary>
                <form action={deleteHighlightPersonAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="id" value={person.id} />
                  <p>確定要刪除這位人物嗎？介紹頁會立即拿掉，不能復原。</p>
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
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-semibold">新增人物</summary>
          <div className="mt-3">
            <PersonForm item={item} template={template} conferenceId={conferenceId} choices={choices} />
          </div>
        </details>
      </div>
    </details>
  );
}

function PersonForm({
  item,
  template,
  conferenceId,
  choices,
  person,
}: {
  item: HighlightItem;
  template: PageTemplate;
  conferenceId: string;
  choices: PersonChoices;
  person?: HighlightPersonItem;
}) {
  const title = PERSON_TITLE_LABELS[template];
  const stakeId = person?.stakeId ?? "";
  const wardId = person?.wardId ?? "";
  // 分在這一類的課程，加上這位人物原本對應的（分類改了也留著，存檔時才不會被清掉）。
  const courses = choices.courses.filter((course) => course.highlightId === item.id || course.id === person?.courseId);
  return (
    <form action={saveHighlightPersonAction} className="flex flex-col gap-3">
      <input type="hidden" name="highlightId" value={item.id} />
      {person && <input type="hidden" name="id" value={person.id} />}
      <TextPair name="name" label="姓名" zh={person?.nameZh} en={person?.nameEn} required />
      <span className="text-sm text-muted-foreground">照卡片上要顯示的寫，例如「沈亦斌 姐妹」「宋長老及宋馬彩鳳姊妹」。</span>
      <UnitFields
        stakes={unitChoices(choices.stakes, stakeId, wardId)}
        stakeId={stakeId}
        wardId={wardId}
        withWard={template !== "missionary"}
      />
      {template === "missionary" && (
        <>
          <TextPair name="serviceArea" label="服務地區" zh={person?.serviceAreaZh} en={person?.serviceAreaEn} />
          <span className="text-sm text-muted-foreground">
            服務地區寫他們服務的地方，例如「高雄傳道部」。卡片上和支聯會分兩行顯示。
          </span>
        </>
      )}
      {courses.length > 0 ? (
        <Field
          label="對應的課程"
          hint={`從分在「${item.titleZh}」的課程挑，課程名稱與教堂會自動帶出，不用另外打。沒有對應的課程就選「沒有」。`}
        >
          <select name="courseId" defaultValue={person?.courseId ?? ""} className={cn(inputClass, "sm:max-w-xl")}>
            <option value="">沒有</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">
          沒有課程分在「{item.titleZh}」。要從課程帶出課程名稱與教堂，請先到「場次與課程」把課程的分類設成「{item.titleZh}」。
        </p>
      )}
      <Field label="教堂" hint="卡片依教堂分組。選了對應的課程時，以課程的教堂為準，這裡不用選。">
        <select name="venueId" defaultValue={person?.venueId ?? ""} className={cn(inputClass, "sm:max-w-md")}>
          <option value="">不選</option>
          {choices.venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
      </Field>
      {title && (
        <>
          <TextPair name="courseTitle" label={title.label} zh={person?.courseTitleZh} en={person?.courseTitleEn} />
          <span className="text-sm text-muted-foreground">{title.hint}</span>
        </>
      )}
      <PersonPhotoField conferenceId={conferenceId} photo={person?.photo ?? null} focus={person?.photoFocus ?? 50} />
      <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
        <legend className="px-1 font-semibold">個人介紹頁</legend>
        <p className="text-sm text-muted-foreground">
          有寫其中一段，卡片才有按鈕連到個人介紹頁。一行一段；大綱一行一點，不用打編號。
        </p>
        {PERSON_SECTIONS[template].map((section) => (
          <TextPair
            key={section}
            name={section}
            label={PERSON_SECTION_LABELS[section](template)}
            zh={person?.[`${section}Zh`]}
            en={person?.[`${section}En`]}
            multiline
          />
        ))}
      </fieldset>
      <SubmitButton className={submitClass}>{person ? `儲存「${person.nameZh}」` : "新增人物"}</SubmitButton>
    </form>
  );
}

/** 支聯會名單的一個支聯會與底下的支會，含停用的（名稱已經標示）。 */
type DirectoryUnit = Omit<UnitStake, "wards"> & { active: boolean; wards: (UnitStake["wards"][number] & { active: boolean })[] };

/** 選單只列出啟用中的支聯會與支會，加上這位人物原本選的（停用了也留著，存檔時才不會被清掉）。 */
function unitChoices(stakes: DirectoryUnit[], stakeId: string, wardId: string): UnitStake[] {
  return stakes
    .filter((stake) => stake.active || stake.id === stakeId)
    .map((stake) => ({
      id: stake.id,
      name: stake.name,
      region: stake.region,
      wards: stake.wards
        .filter((ward) => ward.active || ward.id === wardId)
        .map((ward) => ({ id: ward.id, name: ward.name })),
    }));
}

function MovePersonButton({ id, direction }: { id: string; direction: "up" | "down" }) {
  return (
    <form action={moveHighlightPersonAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <SubmitButton className={cn(buttonVariants({ variant: "outline" }), buttonClass)}>
        {direction === "up" ? "↑ 往前移" : "↓ 往後移"}
      </SubmitButton>
    </form>
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
  item?: HomeItem | HighlightItem;
  submitLabel: string;
}) {
  const highlight = item && "people" in item ? item : undefined;
  return (
    <form action={saveContentItem} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <TextPair name="title" label={TITLE_LABELS[kind]} zh={item?.titleZh} en={item?.titleEn} required />
      {kind === "highlight" ? (
        <>
          <TextPair name="summary" label="卡片上的一句話" zh={item?.summaryZh} en={item?.summaryEn} />
          <Field
            label="介紹頁版型"
            hint="角落課程、靈性課程、向貴賓致敬、與年長夫婦傳教士有約、靜態展示選對應的版型：介紹頁上面是副標與介紹內容，下面是依教堂分組的人物卡片（存檔後在這一項下面新增人物），每位人物有自己的個人介紹頁。"
          >
            <select name="pageTemplate" defaultValue={highlight?.pageTemplate ?? ""} className={cn(inputClass, "sm:max-w-md")}>
              <option value="">一般介紹頁（介紹內容加各教堂分頁）</option>
              {(Object.keys(TEMPLATE_LABELS) as PageTemplate[]).map((template) => (
                <option key={template} value={template}>
                  {TEMPLATE_LABELS[template]}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 font-semibold">人物卡片版型的標題區與引言（一般介紹頁不顯示）</legend>
            <TextPair name="subtitle" label="副標" zh={highlight?.subtitleZh} en={highlight?.subtitleEn} />
            <span className="text-sm text-muted-foreground">標題下面的一句話，例如「80 歲長輩，持守到底的美好榜樣。」</span>
            <TextPair name="leadQuote" label="引言" zh={highlight?.leadQuoteZh} en={highlight?.leadQuoteEn} multiline />
            <span className="text-sm text-muted-foreground">介紹內容左邊放大的一句話。不填就只有介紹內容。</span>
            <TextPair
              name="leadQuoteSource"
              label="引言出處"
              zh={highlight?.leadQuoteSourceZh}
              en={highlight?.leadQuoteSourceEn}
            />
          </fieldset>
          <RichTextEditor
            name="bodyZh"
            label="介紹內容（中文）"
            hint="介紹頁最上面的簡介，例如練唱影片的連結、要帶什麼。各教堂不同的細節寫在下面的「各教堂分頁」。按「圖片」可以插入圖片，英文版要有圖，英文的介紹內容也要插入。"
            defaultValue={item?.bodyZh ?? ""}
            saveLabel={submitLabel}
            imageFolder={conferenceId}
          />
          <RichTextEditor
            name="bodyEn"
            label="介紹內容（英文）"
            hint="不寫的話英文版顯示中文。"
            defaultValue={item?.bodyEn ?? ""}
            saveLabel={submitLabel}
            imageFolder={conferenceId}
          />
          {item && missingEnglish(item.bodyZh, item.bodyEn) && (
            <span className="text-sm font-semibold text-destructive">⚠ 介紹內容的英文還沒填，英文版會顯示中文。</span>
          )}
        </>
      ) : (
        <TextPair
          name="body"
          label={kind === "faq" ? "答案" : "內文"}
          zh={item?.bodyZh}
          en={item?.bodyEn}
          required={kind === "faq"}
          multiline
        />
      )}
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
