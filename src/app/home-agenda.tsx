"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { AgendaRow, CourseGroup, Venue } from "@/lib/home-content";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

// 和 Tailwind 的 md 同一個寬度（見 HeroImage）。
const WIDE_QUERY = "(min-width: 48rem)";

/**
 * 首頁的大會程序（#85）：三個大按鈕選教堂（不用下拉選單），下面是那間教堂的地址、地圖與時間軸。
 * 選教堂、展開課程都只在畫面上切換，不重新載入頁面。
 * 課程用 <details>，關掉 JavaScript 也能點開；伺服器畫的是第一間教堂、只展開第一個場次，
 * 電腦寬度在瀏覽器上再全部展開。接了大會特色的列（例如靜態展示）直接列出這間教堂的人物，不用展開。
 */
export function HomeAgenda({
  venues,
  locale,
  highlightPath,
}: {
  venues: Venue[];
  locale: Locale;
  highlightPath: string;
}) {
  const t = messages[locale].home;
  const [selected, setSelected] = useState(0);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const venue = venues[selected] ?? venues[0];
  const firstSession = venue.agenda.findIndex((row) => row.courseGroups);

  return (
    <section id="agenda" className="-mx-5 flex scroll-mt-4 flex-col gap-5 bg-muted px-5 py-8 md:mx-0 md:rounded-lg md:px-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading font-bold">{t.agendaHeading}</h2>
        <p>{t.agendaIntro}</p>
      </div>
      <div role="group" aria-label={t.venuePickerLabel} className="grid grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-2">
        {venues.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            aria-pressed={index === selected}
            onClick={() => setSelected(index)}
            className={cn(
              buttonVariants({ variant: index === selected ? "default" : "outline" }),
              "h-auto min-h-(--button-min-height) border-2 border-primary px-2 py-2 text-(length:--text-body-size) leading-snug font-bold whitespace-normal",
            )}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-lg bg-background p-5">
        <h3 className="text-lead font-bold">{venue.name}</h3>
        {venue.address && <p>{venue.address}</p>}
        {venue.mapUrl && (
          <a
            href={venue.mapUrl}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto min-h-(--button-min-height) border-2 border-primary px-6 py-3 text-(length:--text-body-size) font-bold whitespace-normal text-primary",
            )}
          >
            {t.openMap}
          </a>
        )}
      </div>
      {venue.agenda.length === 0 ? (
        <p>{t.agendaComingSoon}</p>
      ) : (
        <ol className="flex flex-col">
          {venue.agenda.map((row, index) => (
            <li key={index} className="flex gap-4 border-t border-card-outline py-4">
              <div className="w-20 shrink-0 leading-snug whitespace-nowrap">
                <div className="font-bold text-primary">{row.start}</div>
                <div className="text-muted-foreground">– {row.end}</div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="text-lead leading-snug font-bold">{row.name}</div>
                {row.place && <p className="text-muted-foreground">{row.place}</p>}
                {row.parts.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {row.parts.map((part, partIndex) => (
                      <li key={partIndex}>
                        <HighlightName
                          name={part.name}
                          highlightId={part.highlightId}
                          path={highlightPath}
                          className="inline-flex min-h-11 items-center rounded-full border border-card-outline bg-background px-4"
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {row.note && <p className="rounded-md bg-background px-3 py-2 whitespace-pre-line">{row.note}</p>}
                {row.courseGroups && (
                  <Courses
                    // 換教堂、換寬度時重新決定預設展開哪些。
                    key={`${venue.id}-${wide}`}
                    groups={row.courseGroups}
                    defaultOpen={wide || index === firstSession}
                    highlightPath={highlightPath}
                    locale={locale}
                  />
                )}
                {row.highlightPeople && <People {...row.highlightPeople} highlightPath={highlightPath} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Courses({
  groups,
  defaultOpen,
  highlightPath,
  locale,
}: {
  groups: CourseGroup[];
  defaultOpen: boolean;
  highlightPath: string;
  locale: Locale;
}) {
  const t = messages[locale].home;
  const count = groups.reduce((total, group) => total + group.courses.length, 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">{t.chooseOneCourse}</p>
      <details open={defaultOpen} className="group">
        <summary
          className={cn(
            buttonVariants({ variant: "outline" }),
            "flex h-auto min-h-(--button-min-height) w-full cursor-pointer list-none justify-between border-2 border-primary px-4 py-3 text-(length:--text-body-size) font-bold whitespace-normal text-primary [&::-webkit-details-marker]:hidden",
          )}
        >
          <span className="group-open:hidden">{t.showCourses(count)}</span>
          <span className="hidden group-open:inline">{t.hideCourses}</span>
          <span aria-hidden className="group-open:rotate-180">
            ﹀
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {groups.map((group, index) => (
            <div key={index} className="flex flex-col gap-2">
              {group.category && (
                <HighlightName
                  name={group.category.name}
                  highlightId={group.category.highlightId}
                  path={highlightPath}
                  className="inline-flex min-h-11 items-center self-start font-bold text-primary"
                />
              )}
              <ul className="flex flex-col gap-2">
                {group.courses.map((course, courseIndex) => (
                  <li key={courseIndex} className="flex flex-col rounded-md border border-card-outline bg-background px-4 py-3">
                    <span className="font-semibold">{course.title}</span>
                    {course.speaker && <span className="text-muted-foreground">{course.speaker}</span>}
                    {course.pairedWith && (
                      <span className="font-bold">
                        {course.pairedWith.isSecond
                          ? t.pairedSecond(course.pairedWith.sessionName)
                          : t.pairedFirst(course.pairedWith.sessionName)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/** 大會特色裡這間教堂的人物：作品名稱與姓名，有個人介紹頁的點作品名稱連過去（沒有作品名稱時點姓名）。 */
function People({
  highlightId,
  people,
  highlightPath,
}: NonNullable<AgendaRow["highlightPeople"]> & { highlightPath: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {people.map((person, index) => {
        const label = person.title || person.name;
        return (
          <li key={index} className="flex flex-col rounded-md border border-card-outline bg-background px-4 py-3">
            {person.personId ? (
              <Link
                href={`${highlightPath}${highlightId}/people/${person.personId}`}
                className="self-start font-semibold text-primary underline"
              >
                {label}
              </Link>
            ) : (
              <span className="font-semibold">{label}</span>
            )}
            {person.title && <span className="text-muted-foreground">{person.name}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** 大會特色的名稱：有介紹內容的連到介紹頁，沒有的只是文字。 */
function HighlightName({
  name,
  highlightId,
  path,
  className,
}: {
  name: string;
  highlightId: string | null;
  path: string;
  className: string;
}) {
  return highlightId ? (
    <Link href={path + highlightId} className={cn(className, "text-primary underline hover:bg-muted")}>
      {name}
    </Link>
  ) : (
    <span className={className}>{name}</span>
  );
}

function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isWide(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
}
