import Link from "next/link";
import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import {
  CARD_SHOWS_COURSE,
  hasPersonPage,
  type Highlight,
  type HighlightPerson,
  type PageTemplate,
} from "@/lib/home-content";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { PreviewBanner } from "./preview/preview-banner";
import { SiteFooter, SiteHeader, type SiteLink } from "./site-chrome";
import { VenueGroups } from "./venue-groups";

// 版面寬度和首頁一樣：手機左右留白，電腦上內容不拉得太寬。
export const wideClass = "mx-auto w-full max-w-(--content-max-width) px-5 md:max-w-5xl";

/**
 * 大會特色介紹頁的人物卡片版型（範本 A，設計稿 docs/design/template-a-cards.dc.html）：
 * 角落課程、靈性課程、向貴賓致敬、與年長夫婦傳教士有約、靜態展示共用，只差資料與卡片的按鈕。
 * 由上到下：Header → 麵包屑 → 標題區（小標、名稱、副標）→ 前言 → 選教堂按鈕與依教堂分組的人物卡片 → Footer。
 * 刻意不放時間、地點、報名按鈕（設計交接說明）。
 * 顏色、字型、字級和首頁一樣用 globals.css 的主視覺設定，首頁視覺定稿（#86）時一起換。
 */
export function ActivityPage({
  highlight,
  template,
  preview,
  t,
}: {
  highlight: Highlight;
  template: PageTemplate;
  preview: boolean;
  t: Messages;
}) {
  const home = preview ? "/preview" : "/";
  const copy = t.activity[template];
  const hasLinks = highlight.people.some((person) => hasPersonPage(person, template));
  // 照場地的順序，只列有人的教堂；沒選教堂的放最後一組。
  const groups = [
    ...highlight.peopleVenues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      people: highlight.people.filter((person) => person.venueId === venue.id),
    })),
    {
      id: "other",
      name: t.activity.otherVenue,
      people: highlight.people.filter(
        (person) => !highlight.peopleVenues.some((venue) => venue.id === person.venueId),
      ),
    },
  ].filter((group) => group.people.length > 0);

  return (
    <ActivityShell t={t} preview={preview}>
      <section className={cn(wideClass, "flex flex-col gap-5 pt-5 pb-9")}>
        <Breadcrumbs t={t} home={home} trail={[]} current={highlight.name} />
        <div className="flex max-w-3xl flex-col gap-3">
          <p className="font-bold tracking-wider text-primary">{t.home.highlightsHeading}</p>
          <h1 className="text-title leading-tight font-bold">{highlight.name}</h1>
          {highlight.subtitle && <p className="text-lead text-muted-foreground">{highlight.subtitle}</p>}
        </div>
      </section>

      {(highlight.leadQuote || highlight.description) && (
        <section className="bg-muted">
          <div className={cn(wideClass, "flex flex-wrap gap-x-14 gap-y-7 py-10")}>
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
              <div className="max-w-190 min-w-0 flex-[999_1_28rem]">
                <Markdown newTabLabel={t.highlight.opensInNewTab} images>
                  {highlight.description}
                </Markdown>
              </div>
            )}
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <section className={cn(wideClass, "flex flex-col gap-8 pt-10 pb-14")}>
          <VenueGroups
            heading={copy.peopleHeading}
            hints={{
              picker: hasLinks ? t.activity.pickVenueAndCard : t.activity.pickVenue,
              noPicker: hasLinks ? t.activity.pickCard : "",
            }}
            labels={{ group: t.activity.venuePickerLabel, all: t.activity.venueAll }}
            groups={groups.map((group) => ({
              id: group.id,
              name: group.name,
              content: (
                <div className="flex flex-col gap-5 border-t border-card-outline pt-6">
                  <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                    <h3 className="text-heading leading-snug font-bold">{group.name}</h3>
                    <span className="text-muted-foreground">{copy.count(group.people.length)}</span>
                  </div>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-5">
                    {group.people.map((person) => (
                      <PersonCard
                        key={person.id}
                        person={person}
                        template={template}
                        href={personPath(highlight.id, person.id, preview)}
                        t={t}
                      />
                    ))}
                  </ul>
                </div>
              ),
            }))}
          />
        </section>
      )}
    </ActivityShell>
  );
}

/** 個人介紹頁的網址；預覽頁連到預覽版，公告上線前也看得到。 */
export function personPath(highlightId: string, personId: string, preview: boolean): string {
  return `${preview ? "/preview" : ""}/highlights/${highlightId}/people/${personId}`;
}

/** 介紹頁與個人介紹頁共用的外框：預覽提示、全站表頭、頁尾。 */
export function ActivityShell({ t, preview, children }: { t: Messages; preview: boolean; children: ReactNode }) {
  // 預覽頁連回預覽首頁，工作人員才看得到公告上線前的內容。
  const home = preview ? "/preview" : "/";
  // 「大會場地」還沒有自己的頁面，先連到首頁的大會程序（有地址與地圖）。
  const links: SiteLink[] = [
    { href: `${home}#about`, label: t.home.navAbout },
    { href: `${home}#agenda`, label: t.home.navAgenda },
    { href: `${home}#agenda`, label: t.home.navVenues },
    { href: `${home}#register`, label: t.home.navRegister, mobile: true },
  ];
  return (
    <>
      {preview && (
        <div className="px-5 pt-3">
          <PreviewBanner>{t.preview.highlight}</PreviewBanner>
        </div>
      )}
      <SiteHeader t={t} home={home} links={links} />
      <main className="flex flex-1 flex-col text-body leading-relaxed">{children}</main>
      <SiteFooter t={t} links={links} />
    </>
  );
}

/** 首頁 › 大會有什麼 › （trail）› 目前這一頁。每個連結至少 44px 高。 */
export function Breadcrumbs({
  t,
  home,
  trail,
  current,
}: {
  t: Messages;
  home: string;
  trail: { href: string; label: string }[];
  current: string;
}) {
  const links = [
    { href: home, label: t.activity.home },
    { href: `${home}#about`, label: t.home.highlightsHeading },
    ...trail,
  ];
  return (
    <nav aria-label={t.activity.breadcrumbLabel}>
      <ol className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
        {links.map((link) => (
          <li key={link.href} className="flex items-center gap-2">
            <Link href={link.href} className="inline-flex min-h-11 items-center text-primary underline">
              {link.label}
            </Link>
            <span aria-hidden>›</span>
          </li>
        ))}
        <li aria-current="page" className="flex min-h-11 items-center">
          {current}
        </li>
      </ol>
    </nav>
  );
}

/** 圓形照片：存的是原始的長方形照片，裁成圓形時對準後台設定的高度（臉不會被切掉）。沒有照片時是淺色圓。 */
export function PersonPhoto({ person, className }: { person: HighlightPerson; className: string }) {
  const photoClass = cn("mx-auto block shrink-0 rounded-full", className);
  return person.photoUrl ? (
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
  );
}

/** 支聯會、支會分兩行；傳教士是在台灣服務的支聯會與服務地區，也分兩行，不會被看成同一個單位。 */
export function PersonUnits({ person, template, t }: { person: HighlightPerson; template: PageTemplate; t: Messages }) {
  const second =
    template === "missionary"
      ? person.serviceArea && t.activity.missionary.serviceArea(person.serviceArea)
      : person.ward;
  return (
    <>
      {person.stake && <span className="text-muted-foreground">{person.stake}</span>}
      {second && <span className="text-muted-foreground">{second}</span>}
    </>
  );
}

/**
 * 一位人物：圓形照片、支聯會與支會、姓名、靠卡片底部的按鈕（連到個人介紹頁）。
 * 角落課程、靜態展示的按鈕是課程（作品）名稱；其他是外框按鈕。個人介紹頁沒有內容時不放按鈕，
 * 課程（作品）名稱照樣顯示。
 */
function PersonCard({
  person,
  template,
  href,
  t,
}: {
  person: HighlightPerson;
  template: PageTemplate;
  href: string;
  t: Messages;
}) {
  const linked = hasPersonPage(person, template);
  const showCourse = CARD_SHOWS_COURSE[template] && person.courseTitle !== "";

  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-card-outline bg-card">
      <PersonPhoto person={person} className="mt-6 size-42" />
      <div className="flex flex-auto flex-col items-center gap-0.5 px-5 pt-4 pb-5 text-center">
        <PersonUnits person={person} template={template} t={t} />
        <span className="mt-1 mb-2 text-lead leading-snug font-bold">{person.name}</span>
        {showCourse ? (
          linked ? (
            <Link
              href={href}
              className="mt-auto flex min-h-14 items-center justify-between gap-2 self-stretch rounded-lg bg-muted px-4 py-2.5 text-left font-bold hover:bg-muted/70"
            >
              <span>{person.courseTitle}</span>
              <span aria-hidden className="shrink-0 text-lead text-primary">
                ›
              </span>
            </Link>
          ) : (
            // 沒有介紹頁時不要做成按鈕的樣子，免得姐妹以為可以點。
            <p className="mt-auto pt-2 font-bold">{person.courseTitle}</p>
          )
        ) : (
          linked && (
            <Link
              href={href}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "mt-auto h-auto min-h-(--button-min-height) self-stretch border-2 border-primary px-4 py-2 text-(length:--text-body-size) font-bold whitespace-normal text-primary",
              )}
            >
              {t.activity[template].linkLabel}
            </Link>
          )
        )}
      </div>
    </li>
  );
}
