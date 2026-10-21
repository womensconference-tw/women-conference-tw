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

// 只蓋住畫面還不夠，按 Tab、Enter 仍會操作到底下的按鈕（Codex 審查）。遮蔽期間在最外層攔下鍵盤：
// 不用 inert，因為等待中程式還要能把焦點移到錯誤訊息上，inert 會讓聚焦失敗（Codex 審查）。
// 可能同時有好幾個遮蔽層，用計數，最後一個結束才放開（Codex 審查）。
// 只放行不會動到網頁內容的瀏覽器快捷鍵（重新整理、分頁、搜尋、縮放）；Option＋Tab、Cmd＋V 這類
// 會移動焦點或改到欄位的都要攔（Codex 審查）。另外擋下所有編輯（打字、貼上、剪下、拖放），
// 不管是從哪個按鍵或選單來的。
let activeOverlays = 0;

const BROWSER_SHORTCUT_KEYS = new Set(["r", "l", "t", "w", "n", "q", "f", "=", "+", "-", "0"]);

function blockKeys(event: KeyboardEvent) {
  const browserShortcut =
    (event.ctrlKey || event.metaKey) && !event.altKey && BROWSER_SHORTCUT_KEYS.has(event.key.toLowerCase());
  if (browserShortcut) return;
  block(event);
}

function block(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

const BLOCKED_EVENTS = ["beforeinput", "paste", "cut", "drop"] as const;

function lock() {
  document.addEventListener("keydown", blockKeys, true);
  for (const type of BLOCKED_EVENTS) document.addEventListener(type, block, true);
}

function unlock() {
  document.removeEventListener("keydown", blockKeys, true);
  for (const type of BLOCKED_EVENTS) document.removeEventListener(type, block, true);
}

function Overlay({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // 焦點移到遮蔽層上；結束時焦點沒被別的程式移走的話，回到原本按的按鈕。
  useEffect(() => {
    const overlay = ref.current;
    const previous = document.activeElement;
    if (activeOverlays++ === 0) lock();
    overlay?.focus();
    return () => {
      if (--activeOverlays === 0) unlock();
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
