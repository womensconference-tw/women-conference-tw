"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buttonClass, inputClass } from "../../ui";

/** 公開頁面的網址，可以一鍵複製；瀏覽器不讓複製時，網址框可以自己選取複製。 */
export function CopyUrl({ url }: { url: string }) {
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
