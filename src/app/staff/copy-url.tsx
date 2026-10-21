"use client";

import { useState, useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buttonClass, inputClass } from "./ui";

/**
 * 公開頁面的網址，可以一鍵複製；瀏覽器不讓複製時，網址框可以自己選取複製。
 * 網域用瀏覽器網址列上的（總管理員實際打開的網站），正式網域、預覽網址、本機都對。
 * 不用請求的標頭組網址：標頭可能被偽造，複製出去的網址會指到別的網站（Codex 審查）。
 * 複製的網址是要分享到 LINE 群組的，一律加上 openExternalBrowser=1，從 LINE 打開時改用手機的瀏覽器。
 */
export function CopyUrl({ path }: { path: string }) {
  // 伺服器上沒有瀏覽器的網址，先只顯示路徑，畫到瀏覽器上再補上網域。
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  const url = origin + path + (path.includes("?") ? "&" : "?") + "openExternalBrowser=1";
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          readOnly
          value={url}
          aria-label="公開網址"
          onFocus={(event) => event.currentTarget.select()}
          className={cn(inputClass, "sm:flex-1")}
        />
        <button type="button" onClick={copy} className={cn(buttonVariants({ variant: "outline" }), buttonClass)}>
          {status === "copied" ? "已複製" : "複製網址"}
        </button>
      </div>
      {status === "failed" && (
        <p role="alert" className="font-semibold text-destructive">
          瀏覽器不讓自動複製，請點網址框，選取後自己複製。
        </p>
      )}
    </div>
  );
}

// 網址列的網域在這一頁不會變，不必訂閱變化。
const noSubscription = () => () => {};
