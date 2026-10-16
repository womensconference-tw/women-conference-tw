"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * 後台表單的送出按鈕。按下後到伺服器回應前停用，並顯示轉圈圈與「處理中…」，
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
    const start = () => setNavigating(true);
    const reset = () => setNavigating(false);
    form.addEventListener("submit", start);
    window.addEventListener("pageshow", reset);
    return () => {
      form.removeEventListener("submit", start);
      window.removeEventListener("pageshow", reset);
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
    </button>
  );
}
