"use client";

import { useState, useSyncExternalStore } from "react";
import { Markdown } from "@/components/markdown";
import { buttonVariants } from "@/components/ui/button";
import type { HighlightVenue } from "@/lib/home-content";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/**
 * 介紹頁的教堂分頁（#100）：和首頁大會程序一樣用大按鈕選教堂，下面是那間教堂的說明與課程。
 * 只在畫面上切換，不重新載入頁面；只有一間教堂時不用按鈕，直接顯示。
 * 伺服器畫出每一間教堂，關掉 JavaScript 時全部依序顯示、沒有按鈕（按了也不會動）；瀏覽器接手後才只顯示選到的那一間。
 */
export function HighlightVenues({ venues, locale }: { venues: HighlightVenue[]; locale: Locale }) {
  const t = messages[locale].highlight;
  // 記住選的是哪一間（不是第幾間）：語言切換等重新讀資料時，教堂少了一間也不會選到不存在的位置；選的那間不見了就回到第一間。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = Math.max(0, venues.findIndex((venue) => venue.id === selectedId));
  const interactive = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const picker = interactive && venues.length > 1;

  return (
    <section className="-mx-5 flex flex-col gap-5 bg-muted px-5 py-8 md:mx-0 md:rounded-lg md:px-8">
      {picker && (
        <div role="group" aria-label={t.venuePickerLabel} className="grid grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-2">
          {venues.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={index === selected}
              onClick={() => setSelectedId(candidate.id)}
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
      {venues.map((venue, index) => (
        <div
          key={venue.id}
          hidden={picker && index !== selected}
          className="flex flex-col gap-4 rounded-lg bg-background p-5"
        >
          <h2 className="text-lead font-bold">{venue.name}</h2>
          {venue.body && <Markdown newTabLabel={t.opensInNewTab}>{venue.body}</Markdown>}
          {venue.courses.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-bold">{t.courses}</h3>
              <ul className="flex flex-col gap-2">
                {venue.courses.map((course, courseIndex) => (
                  <li key={courseIndex} className="flex flex-col rounded-md border border-card-outline px-4 py-3">
                    <span className="text-muted-foreground">{course.sessionName}</span>
                    <span className="font-semibold">{course.title}</span>
                    {course.speaker && <span className="text-muted-foreground">{course.speaker}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// 「瀏覽器接手了沒」不會再變，不必訂閱。
function subscribeNothing() {
  return () => {};
}
