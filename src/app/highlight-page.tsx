import Link from "next/link";
import { notFound } from "next/navigation";
import { LanguageSwitch } from "@/components/language-switch";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference, homePhase } from "@/lib/conference";
import { getHighlight } from "@/lib/home-content";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActivityPage } from "./activity-page";
import { HighlightVenues } from "./highlight-venues";
import { PreviewBanner } from "./preview/preview-banner";

/**
 * 大會特色的介紹頁（#82）：名稱、簡介（Markdown）、教堂分頁（#100）、回首頁。首頁「大會有什麼」的卡片連過來。
 * 選了人物版型的（向貴賓致敬、與年長夫婦傳教士有約、靜態展示）改用 ActivityPage。
 * 前台（/highlights/<編號>）與後台的預覽（/preview/highlights/<編號>）共用：和首頁一樣，
 * 前台公告上線前看不到，預覽一直看得到。只有目前年度的；過去年度、找不到、沒有內容的都顯示「找不到」。
 */
export async function HighlightPage({ id, preview }: { id: string; preview: boolean }) {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const [conference, highlight] = await Promise.all([
    getCurrentConference(supabase, new Date()),
    getHighlight(supabase, id, locale),
  ]);
  if (!highlight || !homePhase(conference, { preview })) notFound();
  if (highlight.template) return <ActivityPage highlight={highlight} template={highlight.template} preview={preview} t={t} locale={locale} />;

  return (
    <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-6 px-5 pt-3 pb-8 text-body leading-relaxed">
      {preview && <PreviewBanner>{t.preview.highlight}</PreviewBanner>}
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <h1 className="text-title leading-tight font-bold">{highlight.name}</h1>
      {highlight.description && <Markdown newTabLabel={t.highlight.opensInNewTab} images>{highlight.description}</Markdown>}
      {highlight.venues.length > 0 && <HighlightVenues venues={highlight.venues} locale={locale} />}
      <BackHomeLink preview={preview} label={t.highlight.backHome} />
    </main>
  );
}

/** 找不到介紹頁時（過去年度、已刪除、沒有內容，或公告上線前的前台）。 */
export async function HighlightNotFound({ preview }: { preview: boolean }) {
  const t = await getMessages();
  return (
    <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-6 px-5 pt-3 pb-8 text-body leading-relaxed">
      <p>{t.highlight.notFound}</p>
      <BackHomeLink preview={preview} label={t.highlight.backHome} />
    </main>
  );
}

// 預覽頁回到預覽首頁，工作人員才看得到公告上線前的內容。
function BackHomeLink({ preview, label }: { preview: boolean; label: string }) {
  return (
    <Link
      href={preview ? "/preview" : "/"}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-auto min-h-(--button-min-height) self-start px-6 py-3 text-(length:--text-body-size) whitespace-normal",
      )}
    >
      {label}
    </Link>
  );
}
