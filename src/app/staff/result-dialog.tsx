"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buttonClass } from "./ui";

/**
 * 上一個動作的結果，用跳出的視窗顯示，按「確定」（或 Esc）關掉。
 * 關掉時把網址的 `?done=`、`?error=` 拿掉，重新整理或按上一頁才不會再跳一次。
 */
export function ResultDialog({ kind, message }: { kind: "done" | "error"; message: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [message]);

  function cleanUrl() {
    const params = new URLSearchParams(searchParams);
    params.delete("done");
    params.delete("error");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
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
