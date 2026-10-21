"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { afterLoading } from "@/components/loading-overlay";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buttonClass } from "./ui";

/**
 * 上一個動作的結果，用跳出的視窗顯示，按「確定」（或 Esc）關掉。
 * 關掉時把網址的 `?done=`、`?error=` 拿掉，重新整理或按上一頁才不會再跳一次。
 * 用瀏覽器的 history.replaceState 改網址（Next.js 會同步 useSearchParams），不像 router.replace 會重新向伺服器要整頁資料。
 * 因為頁面沒有重新載入，這個元件會留著；所以依網址上的代碼決定要不要打開：
 * 再做一次同樣的動作時，網址又出現同一個代碼，視窗再打開一次。
 */
export function ResultDialog({ kind, message }: { kind: "done" | "error"; message: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const searchParams = useSearchParams();
  const code = searchParams.get(kind);

  useEffect(() => {
    // 送出按鈕的遮蔽層可能還沒結束，等它結束再打開，對話框才能操作。
    afterLoading(() => {
      const dialog = ref.current;
      if (code && dialog && !dialog.open) dialog.showModal();
    });
  }, [code]);

  function cleanUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("done");
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <dialog
      ref={ref}
      role={kind === "error" ? "alertdialog" : "dialog"}
      aria-labelledby="result-dialog-title"
      aria-describedby="result-dialog-message"
      onClose={cleanUrl}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border-2 bg-background p-6 text-foreground backdrop:bg-black/50",
        kind === "error" ? "border-destructive" : "border-primary",
      )}
    >
      <h2 id="result-dialog-title" className={cn("text-xl font-bold", kind === "error" && "text-destructive")}>
        {kind === "error" ? "沒有完成" : "完成"}
      </h2>
      <p id="result-dialog-message" className="mt-3 text-lg">
        {message}
      </p>
      <form method="dialog" className="mt-6 flex justify-end">
        <button autoFocus className={cn(buttonVariants(), buttonClass, "min-w-24 font-bold")}>
          確定
        </button>
      </form>
    </dialog>
  );
}
