import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference, homePhase } from "@/lib/conference";
import { getVenuePage } from "@/lib/home-content";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActivityShell, Breadcrumbs, wideClass } from "./activity-page";
import { venuePath } from "./feature-page";

/**
 * 圖文型大會特色的各教堂頁（範本 C，設計稿 docs/design/template-c-venue-team.dc.html）：
 * 麵包屑 → 教堂名與節目名稱 → 切換其他教堂 → 海報（選填）→ 製作靈感（選填）→ 團隊成員卡 → 回到活動。
 * 前台與後台預覽共用，規則和介紹頁一樣；這間教堂沒有內容時顯示「找不到」。
 */
export async function VenuePage({ highlightId, venueId, preview }: { highlightId: string; venueId: string; preview: boolean }) {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const [conference, page] = await Promise.all([
    getCurrentConference(supabase, new Date()),
    getVenuePage(supabase, highlightId, venueId, locale),
  ]);
  if (!page || !homePhase(conference, { preview })) notFound();

  const home = preview ? "/preview" : "/";
  const activityPath = `${preview ? "/preview" : ""}/highlights/${page.highlight.id}`;
  const switchClass = "inline-flex min-h-13 items-center rounded-lg border-2 px-5 py-1.5 leading-snug";

  return (
    <ActivityShell t={t} preview={preview}>
      <section className={cn(wideClass, "flex flex-col gap-5 pt-5 pb-8")}>
        <Breadcrumbs
          t={t}
          home={home}
          trail={[{ href: activityPath, label: page.highlight.name }]}
          current={page.venue.name}
        />
        <div className="flex flex-col gap-2">
          <p className="font-bold tracking-wider text-primary">{page.highlight.name}</p>
          <h1 className="text-title leading-tight font-bold">{page.venue.name}</h1>
          {page.showTitle && <p className="text-lead font-semibold text-muted-foreground">{page.showTitle}</p>}
        </div>
        {page.venues.length > 1 && (
          <nav aria-label={t.activity.otherVenues}>
            <ul className="flex flex-wrap gap-2.5">
              {page.venues.map((venue) => (
                <li key={venue.id}>
                  {venue.id === page.venue.id ? (
                    <span aria-current="page" className={cn(switchClass, "border-primary bg-primary font-bold text-primary-foreground")}>
                      {venue.name}
                    </span>
                  ) : (
                    <Link
                      href={venuePath(page.highlight.id, venue.id, preview)}
                      className={cn(switchClass, "border-card-outline bg-card font-medium hover:bg-muted")}
                    >
                      {venue.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>

      {page.poster && (
        <section aria-label={t.activity.poster} className={cn(wideClass, "flex flex-col items-center gap-2 pb-10")}>
          {/* 點海報開原圖，看得清楚曲目與演出者。連結的名稱是海報的圖片說明，下面的提示說明點了會怎樣。 */}
          <a
            href={page.poster.url}
            target="_blank"
            rel="noopener"
            aria-describedby="poster-hint"
            className="block w-full max-w-140"
          >
            {/* 存放空間的公開網址，不經過 Next.js 的圖片最佳化。圖片說明沒填（舊資料）時至少說出這是哪間教堂的海報。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={page.poster.url}
              alt={page.poster.alt || `${page.venue.name}${t.activity.posterOf}`}
              className="h-auto w-full rounded-2xl"
            />
          </a>
          <p id="poster-hint" className="text-muted-foreground">
            {t.activity.posterEnlarge}
            {t.highlight.opensInNewTab}
          </p>
        </section>
      )}

      {page.inspiration && (
        <section aria-labelledby="inspiration" className="bg-secondary">
          <div className={cn(wideClass, "flex flex-wrap gap-x-14 gap-y-5 py-11")}>
            <h2 id="inspiration" className="flex-[1_1_16rem] text-heading leading-snug font-bold">
              {t.activity.inspiration}
            </h2>
            <div className="max-w-170 min-w-0 flex-[999_1_28rem]">
              <Markdown newTabLabel={t.highlight.opensInNewTab} images>
                {page.inspiration}
              </Markdown>
            </div>
          </div>
        </section>
      )}

      <section className={cn(wideClass, "flex flex-col gap-6 pt-12 pb-16")}>
        {page.team.length > 0 && (
          <>
            <h2 className="text-heading leading-snug font-bold">{t.activity[page.highlight.template].teamHeading}</h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-6">
              {page.team.map((member) => (
                <article key={member.id} className="flex flex-col gap-4 rounded-2xl border border-card-outline bg-card p-7">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                    {member.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.photoUrl}
                        alt={member.name}
                        loading="lazy"
                        className="size-35 shrink-0 rounded-full object-cover"
                        style={{ objectPosition: `50% ${member.photoFocus}%` }}
                      />
                    ) : (
                      <div aria-hidden className="size-35 shrink-0 rounded-full bg-muted" />
                    )}
                    <div className="flex flex-col gap-0.5">
                      {member.role && (
                        <span className="self-start rounded-full bg-muted px-3 py-0.5 font-bold text-primary">{member.role}</span>
                      )}
                      <h3 className="mt-1.5 text-heading leading-snug font-bold">{member.name}</h3>
                    </div>
                  </div>
                  {member.bio.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {member.bio.map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        <Link
          href={activityPath}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-auto min-h-(--button-min-height) gap-2 self-start border-2 border-primary px-5 py-2 text-(length:--text-body-size) font-bold whitespace-normal text-primary",
          )}
        >
          <span aria-hidden>‹</span>
          {t.activity.backTo(page.highlight.name)}
        </Link>
      </section>
    </ActivityShell>
  );
}
