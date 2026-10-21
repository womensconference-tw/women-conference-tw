"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "@/components/loading-overlay";
import { cn } from "@/lib/utils";

// GET 表單換頁最多等這麼久，之後就算沒收到任何事件也解除遮蔽。
const NAVIGATION_TIMEOUT_MS = 15_000;

/**
 * 後台表單的送出按鈕。按下後到伺服器回應前停用，並顯示轉圈圈與「處理中…」，整個畫面也蓋上遮蔽層，
 * 使用者才不會以為按鈕沒反應而一按再按。
 * 伺服器動作的表單由 useFormStatus 得知送出中；一般的 GET 表單（例如搜尋）會整頁重新載入，
 * 要給 navigates，改在送出時自己記下，從上一頁回來（瀏覽器快取的頁面）時恢復。
 */
export function SubmitButton({
  className,
  pendingLabel = "處理中…",
  navigates = false,
  children,
}: {
  className?: string;
  pendingLabel?: string;
  /** 一般的 GET 表單，送出後整頁換掉。 */
  navigates?: boolean;
  children: ReactNode;
}) {
  const { pending: actionPending } = useFormStatus();
  const [navigating, setNavigating] = useState(false);
  const pending = actionPending || navigating;
  const ref = useRef<HTMLButtonElement>(null);

  // 等表單真的送出（submit 事件）才停用。在按下時就停用的話，React 會在瀏覽器送出前先更新畫面，
  // 停用的按鈕就送不出表單了。欄位沒填好時瀏覽器不會觸發 submit，也就不會卡在處理中。
  useEffect(() => {
    const form = ref.current?.form;
    if (!navigates || !form) return;
    // 按瀏覽器的「停止」中止換頁時不會觸發 pageshow，畫面會一直被遮住：支援 Navigation API 的瀏覽器
    // 會觸發 navigateerror；不支援的，過一段時間也自動解除，至少不會卡死到要重新整理。
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      clearTimeout(timer);
      setNavigating(false);
    };
    const start = () => {
      setNavigating(true);
      clearTimeout(timer);
      timer = setTimeout(reset, NAVIGATION_TIMEOUT_MS);
    };
    form.addEventListener("submit", start);
    window.addEventListener("pageshow", reset);
    navigation?.addEventListener("navigateerror", reset);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("submit", start);
      window.removeEventListener("pageshow", reset);
      navigation?.removeEventListener("navigateerror", reset);
    };
  }, [navigates]);

  return (
    <button
      ref={ref}
      disabled={pending}
      aria-busy={pending}
      className={cn(className, "inline-flex items-center gap-2 disabled:cursor-wait")}
    >
      {pending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {pending ? pendingLabel : children}
      <LoadingOverlay show={pending} label={pendingLabel} />
    </button>
  );
}
