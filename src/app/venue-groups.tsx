"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 人物卡片版型介紹頁的選教堂按鈕（全部教堂、各教堂）與依教堂分組的卡片：姐妹可以只看自己要去的那間教堂。
 * 只在畫面上切換，不重新載入頁面。伺服器畫出全部的組，關掉 JavaScript 時全部顯示、沒有按鈕（和教堂分頁一樣）；
 * 只有一組時也不放按鈕。
 */
export function VenueGroups({
  heading,
  hints,
  labels,
  groups,
}: {
  heading: string;
  /** 按鈕上面的說明：有按鈕時與沒有按鈕時；空字串是不顯示。 */
  hints: { picker: string; noPicker: string };
  labels: { group: string; all: string };
  /** 每一組的編號、名稱（按鈕文字）與已經畫好的內容，照順序。 */
  groups: { id: string; name: string; content: ReactNode }[];
}) {
  // 記住選的是哪一間：選的那間不見了（語言切換等重新讀資料）就回到全部。
  const [selected, setSelected] = useState<string>("all");
  const interactive = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const picker = interactive && groups.length > 1;
  const current = groups.some((group) => group.id === selected) ? selected : "all";
  const options = [{ id: "all", name: labels.all }, ...groups];
  const hint = picker ? hints.picker : hints.noPicker;

  return (
    <>
      <div className="flex flex-col gap-3">
        <h2 className="text-heading leading-snug font-bold">{heading}</h2>
        {hint && <p className="text-muted-foreground">{hint}</p>}
        {picker && (
          <div role="group" aria-label={labels.group} className="flex flex-wrap gap-2.5">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === current}
                onClick={() => setSelected(option.id)}
                className={cn(
                  buttonVariants({ variant: option.id === current ? "default" : "outline" }),
                  "h-auto min-h-14 border-2 px-5 py-2 text-(length:--text-body-size) leading-snug whitespace-normal",
                  option.id === current ? "border-primary font-bold" : "font-medium",
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {groups.map((group) => (
        <div key={group.id} hidden={picker && current !== "all" && current !== group.id}>
          {group.content}
        </div>
      ))}
    </>
  );
}

// 「瀏覽器接手了沒」不會再變，不必訂閱。
function subscribeNothing() {
  return () => {};
}
