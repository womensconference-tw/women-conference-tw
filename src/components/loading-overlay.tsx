"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * 等伺服器回應時蓋住整個畫面：背景變暗、正中間轉圈圈，使用者一看就知道有按到，
 * 也按不到底下的其他按鈕。
 * 放進 body 而不是放在按鈕裡：按鈕按下時會微微位移（transform），fixed 會變成相對按鈕定位，蓋不滿畫面。
 * React 的點擊事件仍會沿著元件傳回按鈕或連結，所以點到遮蔽層時要擋下，免得又送出或又換頁一次。
 */
export function LoadingOverlay({ show, label }: { show: boolean; label: string }) {
  if (!show || typeof document === "undefined") return null;
  return createPortal(<Overlay label={label} />, document.body);
}

function Overlay({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // 只蓋住畫面還不夠，按 Tab 仍會跑到底下的按鈕、按 Enter 又送出另一件事（Codex 審查）。
  // 遮蔽期間把 body 底下其他東西設成 inert（不能點、不能聚焦），焦點移到遮蔽層上。
  // 結束後還原；焦點沒被別的程式移走的話，回到原本按的按鈕。
  useEffect(() => {
    const overlay = ref.current;
    if (!overlay) return;
    const previous = document.activeElement;
    const blocked = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element !== overlay && element instanceof HTMLElement && !element.inert,
    );
    for (const element of blocked) element.inert = true;
    overlay.focus();
    return () => {
      for (const element of blocked) element.inert = false;
      const active = document.activeElement;
      if ((active === overlay || active === document.body || active === null) && previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      tabIndex={-1}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="fixed inset-0 z-50 flex cursor-wait items-center justify-center bg-black/50 outline-none"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg bg-background px-8 py-6 text-foreground shadow-lg">
        <LoaderCircle aria-hidden className="size-10 animate-spin text-primary" />
        <p className="text-lg font-semibold">{label}</p>
      </div>
    </div>
  );
}
