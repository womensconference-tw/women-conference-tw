import Link from "next/link";
import { Markdown } from "@/components/markdown";
import type { FeatureTemplate, Highlight } from "@/lib/home-content";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { ActivityShell, Breadcrumbs, wideClass } from "./activity-page";

/**
 * 大會特色介紹頁的圖文型版型（範本 B，設計稿 docs/design/template-b-feature.dc.html）：即席唱詩班、迷妳音樂會共用。
 * 由上到下：Header → 麵包屑 → 標題區 → 各教堂大按鈕（連到各教堂頁，範本 C）→ 活動圖片 → 介紹內容與結語 → Footer。
 * 刻意不放時間、地點、報名按鈕（設計交接說明）。
 */
export function FeaturePage({
  highlight,
  template,
  preview,
  t,
}: {
  highlight: Highlight;
  template: FeatureTemplate;
  preview: boolean;
  t: Messages;
}) {
  const home = preview ? "/preview" : "/";

  return (
    <ActivityShell t={t} preview={preview}>
      <section className={cn(wideClass, "flex flex-col gap-5 pt-5 pb-8")}>
        <Breadcrumbs t={t} home={home} trail={[]} current={highlight.name} />
        <div className="flex max-w-3xl flex-col gap-3">
          <p className="font-bold tracking-wider text-primary">{t.home.highlightsHeading}</p>
          <h1 className="text-title leading-tight font-bold">{highlight.name}</h1>
          {highlight.subtitle && <p className="text-lead text-muted-foreground">{highlight.subtitle}</p>}
        </div>
        {highlight.venuePages.length > 0 && (
          <div className="mt-2 flex flex-col gap-2.5">
            <h2 className="font-bold">{t.activity[template].venuePrompt}</h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
              {highlight.venuePages.map((venue) => (
                <li key={venue.id} className="flex">
                  <Link
                    href={venuePath(highlight.id, venue.id, preview)}
                    className="flex min-h-16 flex-auto items-center justify-between gap-3 rounded-xl border-2 border-primary bg-card px-5 py-2.5 text-lead leading-snug font-bold hover:bg-muted"
                  >
                    <span>{venue.name}</span>
                    <span aria-hidden className="text-primary">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {highlight.image && (
        <section className={wideClass}>
          {/* 存放空間的公開網址，不經過 Next.js 的圖片最佳化（和介紹內容的圖片一樣）。手機裁 4:3、電腦 3:1。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={highlight.image.url}
            alt={highlight.image.alt}
            className="aspect-4/3 w-full rounded-2xl object-cover sm:aspect-3/1"
          />
        </section>
      )}

      {(highlight.description || highlight.closing) && (
        <section className={cn(wideClass, "pt-10 pb-16")}>
          <div className="flex max-w-190 flex-col gap-4">
            {highlight.description && (
              <Markdown newTabLabel={t.highlight.opensInNewTab} images>
                {highlight.description}
              </Markdown>
            )}
            {highlight.closing && <p className="mt-2 text-lead leading-relaxed font-semibold text-primary">{highlight.closing}</p>}
          </div>
        </section>
      )}
    </ActivityShell>
  );
}

/** 各教堂頁的網址；預覽頁連到預覽版，公告上線前也看得到。 */
export function venuePath(highlightId: string, venueId: string, preview: boolean): string {
  return `${preview ? "/preview" : ""}/highlights/${highlightId}/venues/${venueId}`;
}
