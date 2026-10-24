import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference, homePhase } from "@/lib/conference";
import { getHighlight, hasPersonPage, PERSON_SECTIONS, type PersonSection } from "@/lib/home-content";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActivityShell, Breadcrumbs, PersonPhoto, PersonUnits, wideClass } from "./activity-page";

/**
 * 人物卡片點進去的個人介紹頁（範本 D，設計稿 docs/design/template-d-person.dc.html）：
 * 麵包屑 → 人物卡（沿用介紹頁的資料）與所屬教堂 → 標題（課程或作品名稱，沒有就用姓名）
 * → 依版型決定的文字段落（PERSON_SECTIONS）→ 回到活動。
 * 前台與後台預覽共用，規則和介紹頁一樣；人物不在、或這一頁沒有內容（卡片沒有按鈕）時顯示「找不到」。
 */
export async function PersonPage({ highlightId, personId, preview }: { highlightId: string; personId: string; preview: boolean }) {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const [conference, highlight] = await Promise.all([
    getCurrentConference(supabase, new Date()),
    getHighlight(supabase, highlightId, locale),
  ]);
  if (!highlight?.template || !homePhase(conference, { preview })) notFound();
  const template = highlight.template;
  // 網址的編號可能是大寫。
  const person = highlight.people.find((candidate) => candidate.id === personId.toLowerCase());
  if (!person || !hasPersonPage(person, template)) notFound();

  const home = preview ? "/preview" : "/";
  const activityPath = `${preview ? "/preview" : ""}/highlights/${highlight.id}`;
  const venue = highlight.peopleVenues.find((candidate) => candidate.id === person.venueId);
  const labels: Record<PersonSection, string> = {
    bio: t.activity[template].bio,
    summary: t.activity.summary,
    outline: t.activity.outline,
  };
  const sections = PERSON_SECTIONS[template].filter((section) => person.sections[section].length > 0);

  return (
    <ActivityShell t={t} preview={preview}>
      <div className={cn(wideClass, "flex flex-col gap-7 pt-5 pb-16")}>
        <Breadcrumbs
          t={t}
          home={home}
          trail={[{ href: activityPath, label: highlight.name }]}
          current={person.name}
        />
        <div className="flex flex-wrap items-start gap-x-14 gap-y-8">
          <aside
            aria-label={person.name}
            className="flex max-w-85 flex-[1_1_16rem] flex-col items-center gap-0.5 rounded-2xl border border-card-outline bg-card px-5 py-7 text-center max-sm:max-w-none"
          >
            <PersonPhoto person={person} className="mb-4 size-50" />
            <PersonUnits person={person} template={template} t={t} />
            <span className="mt-1 text-lead leading-snug font-bold">{person.name}</span>
            {venue && (
              <span className="mt-3 rounded-full bg-muted px-3.5 py-1 font-bold text-primary">{venue.name}</span>
            )}
          </aside>
          <article className="flex max-w-180 min-w-0 flex-[999_1_30rem] flex-col gap-7">
            <div className="flex flex-col gap-2">
              <p className="font-bold tracking-wider text-primary">{highlight.name}</p>
              <h1 className="text-title leading-tight font-bold">{person.courseTitle || person.name}</h1>
            </div>
            {sections.map((section) => (
              <section key={section} className="flex flex-col gap-3 border-t border-card-outline pt-5">
                <h2 className="text-heading leading-snug font-bold text-primary">{labels[section]}</h2>
                {section === "outline" ? (
                  <ol className="flex list-decimal flex-col gap-2 pl-7">
                    {person.sections.outline.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ol>
                ) : (
                  <div className="flex flex-col gap-3">
                    {person.sections[section].map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                )}
              </section>
            ))}
            <Link
              href={activityPath}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-auto min-h-(--button-min-height) gap-2 self-start border-2 border-primary px-5 py-2 text-(length:--text-body-size) font-bold whitespace-normal text-primary",
              )}
            >
              <span aria-hidden>‹</span>
              {t.activity.backTo(highlight.name)}
            </Link>
          </article>
        </div>
      </div>
    </ActivityShell>
  );
}
