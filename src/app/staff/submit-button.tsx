"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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

  useEffect(() => {
    const reset = () => setNavigating(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <button
      disabled={pending}
      aria-busy={pending}
      onClick={(event) => {
        // 欄位沒填好時瀏覽器不會送出，也不記。
        if (navigates && event.currentTarget.form?.checkValidity()) setNavigating(true);
      }}
      className={cn(className, "inline-flex items-center gap-2 disabled:cursor-wait")}
    >
      {pending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
