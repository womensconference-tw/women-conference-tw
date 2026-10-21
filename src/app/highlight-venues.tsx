"use client";

import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import type { HighlightVenue } from "@/lib/home-content";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/**
 * 介紹頁的教堂分頁（#100）：和首頁大會程序一樣用大按鈕選教堂，下面是那間教堂的說明與課程。
 * 只在畫面上切換，不重新載入頁面；只有一間教堂時不用按鈕，直接顯示。
 */
export function HighlightVenues({ venues, locale }: { venues: HighlightVenue[]; locale: Locale }) {
  const t = messages[locale].highlight;
  const [selected, setSelected] = useState(0);
  const venue = venues[selected] ?? venues[0];

  return (
    <section className="-mx-5 flex flex-col gap-5 bg-muted px-5 py-8 md:mx-0 md:rounded-lg md:px-8">
      {venues.length > 1 && (
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
      )}
      <div className="flex flex-col gap-4 rounded-lg bg-background p-5">
        <h2 className="text-lead font-bold">{venue.name}</h2>
        {venue.body && <Markdown newTabLabel={t.opensInNewTab}>{venue.body}</Markdown>}
        {venue.courses.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">{t.courses}</h3>
            <ul className="flex flex-col gap-2">
              {venue.courses.map((course, index) => (
                <li key={index} className="flex flex-col rounded-md border border-card-outline px-4 py-3">
                  <span className="text-muted-foreground">{course.sessionName}</span>
                  <span className="font-semibold">{course.title}</span>
                  {course.speaker && <span className="text-muted-foreground">{course.speaker}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
