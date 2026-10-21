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
  return createPortal(<Overlay label={label} />, overlayRoot());
}

/*
 * 遮蔽期間 body 底下其他東西都設成 inert：不能點、不能聚焦、輔具（螢幕閱讀器）也操作不到，
 * 輸入法組字也進不去（只攔鍵盤事件擋不住這些，Codex 審查）。
 * 遮蔽層都放在同一個不會被設成 inert 的容器裡；可能同時有好幾個遮蔽層，用計數，最後一個結束才解除（Codex 審查）。
 * inert 期間程式要聚焦或打開對話框都會失敗，所以這類動作要用 afterLoading，等解除後才做（Codex 審查）。
 */
let root: HTMLElement | null = null;
let activeOverlays = 0;
let locked: HTMLElement[] = [];
let queued: (() => void)[] = [];

function overlayRoot() {
  if (!root || !root.isConnected) {
    root = document.createElement("div");
    document.body.append(root);
  }
  return root;
}

function lock() {
  locked = Array.from(document.body.children).filter(
    (element): element is HTMLElement => element !== root && element instanceof HTMLElement && !element.inert,
  );
  for (const element of locked) element.inert = true;
}

function unlock() {
  for (const element of locked) element.inert = false;
  locked = [];
  const callbacks = queued;
  queued = [];
  for (const callback of callbacks) callback();
}

/** 要聚焦、打開對話框時用：沒有遮蔽層就馬上做，有的話等遮蔽層都結束、畫面解除鎖定後再做。 */
export function afterLoading(callback: () => void) {
  if (activeOverlays === 0) callback();
  else queued.push(callback);
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
