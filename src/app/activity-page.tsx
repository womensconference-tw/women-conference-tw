import Link from "next/link";
import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import type { Highlight, HighlightPerson, PageTemplate } from "@/lib/home-content";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { PreviewBanner } from "./preview/preview-banner";
import { RegionFilter } from "./region-filter";
import { SiteFooter, SiteHeader } from "./site-chrome";

// 版面寬度和首頁一樣：手機左右留白，電腦上內容不拉得太寬。
const wideClass = "mx-auto w-full max-w-(--content-max-width) px-5 md:max-w-5xl";

/** 傳教士頁的人比較少，卡片和照片都大一點（設計稿）。 */
const BIG_CARDS: Record<PageTemplate, boolean> = { honor: false, missionary: true, exhibit: false };

/**
 * 大會特色介紹頁的人物版型（設計稿 docs/design/activity-*.dc.html）：向貴賓致敬、與年長夫婦傳教士有約、靜態展示
 * 三頁共用，只差資料與人物卡片的按鈕。由上到下：Header → 麵包屑 → 標題區（小標、名稱、副標）
 * → 介紹區（引言與介紹內容，寬度不夠時上下排）→ 北／中／南區按鈕與人物卡片 → Footer。
 * 刻意不放時間、地點、怎麼參加、報名按鈕（設計交接說明），也不分教堂。
 * 顏色、字型、字級和首頁一樣用 globals.css 的主視覺設定，首頁視覺定稿（#86）時一起換。
 */
export function ActivityPage({
  highlight,
  template,
  preview,
  t,
  locale,
}: {
  highlight: Highlight;
  template: PageTemplate;
  preview: boolean;
  t: Messages;
  locale: Locale;
}) {
  // 預覽頁連回預覽首頁，工作人員才看得到公告上線前的內容。
  const home = preview ? "/preview" : "/";
  const copy = t.activity[template];
  const hasLinks = highlight.people.some((person) => person.linkUrl);

  return (
    <>
      {preview && (
        <div className="px-5 pt-3">
          <PreviewBanner>{t.preview.highlight}</PreviewBanner>
        </div>
      )}
      <SiteHeader
        t={t}
        home={home}
        links={[
          { href: `${home}#about`, label: t.home.navAbout },
          { href: `${home}#agenda`, label: t.home.navAgenda },
          { href: `${home}#register`, label: t.home.navRegister },
        ]}
      />
      <main className="flex flex-1 flex-col text-body leading-relaxed">
        <section className={cn(wideClass, "flex flex-col gap-5 pt-5 pb-10")}>
          <nav aria-label={t.activity.breadcrumbLabel}>
            <ol className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
              <li className="flex items-center gap-2">
                <CrumbLink href={home}>{t.activity.home}</CrumbLink>
                <span aria-hidden>›</span>
              </li>
              <li className="flex items-center gap-2">
                <CrumbLink href={`${home}#about`}>{t.home.highlightsHeading}</CrumbLink>
                <span aria-hidden>›</span>
              </li>
              <li aria-current="page" className="flex min-h-11 items-center">
                {highlight.name}
              </li>
            </ol>
          </nav>
          <div className="flex max-w-3xl flex-col gap-3">
            <p className="font-bold tracking-wider text-primary">{t.home.highlightsHeading}</p>
            <h1 className="text-title leading-tight font-bold">{highlight.name}</h1>
            {highlight.subtitle && <p className="text-lead text-muted-foreground">{highlight.subtitle}</p>}
          </div>
        </section>

        {(highlight.leadQuote || highlight.description) && (
          <section className="bg-muted">
            <div className={cn(wideClass, "flex flex-wrap gap-x-14 gap-y-7 py-11")}>
              {highlight.leadQuote && (
                <figure className="flex flex-[1_1_20rem] flex-col gap-3">
                  <blockquote className="text-lead leading-relaxed font-semibold whitespace-pre-line">
                    {highlight.leadQuote}
                  </blockquote>
                  {highlight.leadQuoteSource && (
                    <figcaption className="text-muted-foreground">{highlight.leadQuoteSource}</figcaption>
                  )}
                </figure>
              )}
              {highlight.description && (
                <div className="max-w-160 min-w-0 flex-[999_1_28rem]">
                  <Markdown newTabLabel={t.highlight.opensInNewTab} images>
                    {highlight.description}
                  </Markdown>
                </div>
              )}
            </div>
          </section>
        )}

        {highlight.people.length > 0 && (
          <section className={cn(wideClass, "flex flex-col gap-6 py-12")}>
            <div className="flex flex-col gap-1">
              <h2 className="text-heading font-bold">{copy.peopleHeading}</h2>
              <p className="text-muted-foreground">
                {copy.peopleCount(highlight.people.length)}
                {/* 英文句子之間要空一格，中文不用。 */}
                {hasLinks && (locale === "en" ? " " : "") + copy.linkHint}
              </p>
            </div>
            <RegionFilter
              locale={locale}
              listClass={cn(
                "grid gap-5",
                // 手機寬度不到一張卡片時一欄，不會撐出左右捲動。
                BIG_CARDS[template]
                  ? "grid-cols-[repeat(auto-fill,minmax(min(100%,18.75rem),1fr))]"
                  : "grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))]",
              )}
              items={highlight.people.map((person) => ({
                id: person.id,
                region: person.region,
                card: <PersonCard person={person} template={template} t={t} />,
              }))}
            />
          </section>
        )}
      </main>
      <SiteFooter t={t} />
    </>
  );
}

function CrumbLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center text-primary underline">
      {children}
    </Link>
  );
}

/**
 * 一位人物：圓形照片、支聯會與支會（傳教士是支聯會與服務地區）、姓名、靠卡片底部的連結按鈕。
 * 照片存的是原始的長方形照片，裁成圓形時對準後台設定的高度（臉不會被切掉）。
 * 向貴賓致敬、傳教士是外框按鈕（沒填按鈕文字用預設文字）；靜態展示的按鈕是作品名稱，沒有連結時只顯示作品名稱。
 */
function PersonCard({ person, template, t }: { person: HighlightPerson; template: PageTemplate; t: Messages }) {
  const big = BIG_CARDS[template];
  const photoClass = cn("mx-auto block shrink-0 rounded-full", big ? "mt-7 size-55" : "mt-6 size-45");
  const exhibit = template === "exhibit";
  const label = person.linkLabel || t.activity[template].linkLabel;
  const exhibitClass =
    "mt-auto flex min-h-(--button-min-height) items-center justify-between gap-3 self-stretch rounded-lg bg-muted px-4 py-2 text-left font-bold";

  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-card-outline bg-card">
      {person.photoUrl ? (
        // 存放空間的公開網址，不經過 Next.js 的圖片最佳化（和介紹內容的圖片一樣）。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={person.photoUrl}
          alt={person.name}
          loading="lazy"
          className={cn(photoClass, "object-cover")}
          style={{ objectPosition: `50% ${person.photoFocus}%` }}
        />
      ) : (
        <div aria-hidden className={cn(photoClass, "bg-muted")} />
      )}
      <div className="flex flex-auto flex-col items-center gap-1 px-5 pt-4 pb-5 text-center">
        {template === "missionary" ? (
          // 傳教士寫的是在台灣服務的支聯會與服務地區，分兩行，不會被看成同一個單位。
          <>
            {person.stake && <span className="text-muted-foreground">{person.stake}</span>}
            {person.serviceArea && (
              <span className="text-muted-foreground">{t.activity.missionary.serviceArea(person.serviceArea)}</span>
            )}
          </>
        ) : (
          (person.stake || person.ward) && (
            <span className="text-muted-foreground">
              {[person.stake, person.ward].filter(Boolean).join(t.activity.unitSeparator)}
            </span>
          )
        )}
        <span className="mb-2 text-lead leading-snug font-bold">{person.name}</span>
        {person.linkUrl ? (
          <CardLink
            href={person.linkUrl}
            className={
              exhibit
                ? cn(exhibitClass, "hover:bg-muted/70")
                : cn(
                    buttonVariants({ variant: "outline" }),
                    "mt-auto h-auto min-h-(--button-min-height) self-stretch border-2 border-primary px-4 py-2 text-(length:--text-body-size) font-bold whitespace-normal text-primary",
                  )
            }
          >
            {exhibit ? (
              <>
                <span>{label}</span>
                <span aria-hidden className="shrink-0 text-lead">
                  ›
                </span>
              </>
            ) : (
              label
            )}
          </CardLink>
        ) : (
          // 沒有連結時不要做成按鈕的樣子，免得姐妹以為可以點。
          exhibit && person.linkLabel && <p className="mt-auto pt-2 font-bold">{person.linkLabel}</p>
        )}
      </div>
    </li>
  );
}

/** 站內用 Link，站外用一般連結（同一個分頁開，和首頁的按鈕一樣）。 */
function CardLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
