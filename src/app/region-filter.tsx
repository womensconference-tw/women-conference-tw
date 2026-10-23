"use client";

import { Fragment, useState, useSyncExternalStore, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { REGIONS, type Region } from "@/lib/staff";
import { cn } from "@/lib/utils";

/**
 * 人物版型介紹頁的北／中／南區按鈕：姐妹可以只看自己那一區的人。區跟著人物所選的支聯會；沒選支聯會的只在「全部」出現。
 * 只在畫面上切換，不重新載入頁面。伺服器畫出全部的卡片，關掉 JavaScript 時全部顯示、沒有按鈕（和教堂分頁一樣）；
 * 沒有任何人選了支聯會時也不放按鈕。
 */
export function RegionFilter({
  items,
  locale,
  listClass,
}: {
  /** 每一位人物的區與已經畫好的卡片（<li>），照排序。 */
  items: { id: string; region: Region | null; card: ReactNode }[];
  locale: Locale;
  listClass: string;
}) {
  const t = messages[locale].activity;
  const [selected, setSelected] = useState<Region | "all">("all");
  const interactive = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const picker = interactive && items.some((item) => item.region);
  const visible = picker && selected !== "all" ? items.filter((item) => item.region === selected) : items;
  const options = [
    { value: "all" as const, label: t.regionButton(t.regionAll, items.length) },
    ...REGIONS.map((region) => ({
      value: region,
      label: t.regionButton(t.regions[region], items.filter((item) => item.region === region).length),
    })),
  ];

  return (
    <>
      {picker && (
        <div role="group" aria-label={t.regionFilterLabel} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === selected}
              onClick={() => setSelected(option.value)}
              className={cn(
                buttonVariants({ variant: option.value === selected ? "default" : "outline" }),
                "h-auto min-h-(--button-min-height) border-2 border-primary px-2 py-2 text-(length:--text-body-size) leading-snug font-bold whitespace-normal",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {visible.length > 0 ? (
        <ul className={listClass}>
          {visible.map((item) => (
            <Fragment key={item.id}>{item.card}</Fragment>
          ))}
        </ul>
      ) : (
        <p role="status" className="text-muted-foreground">
          {t.regionEmpty}
        </p>
      )}
    </>
  );
}

// 「瀏覽器接手了沒」不會再變，不必訂閱。
function subscribeNothing() {
  return () => {};
}
