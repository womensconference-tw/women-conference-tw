"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { YearExportError } from "@/lib/year-export";
import { alertClass, buttonClass } from "../../../ui";

const ERRORS: Record<YearExportError, string> = {
  not_admin: "只有總管理員能下載年度 Excel。",
  not_found: "找不到這個年度，請重新整理頁面再試一次。",
  conference_not_ended: "大會還沒結束（大會日期翌日台北時間 00:00 之後才能下載）。",
  personal_data_cleared: "這個年度已經清除個資，不能再下載 Excel。",
  unavailable: "系統暫時出了問題，Excel 沒有產生。請稍後再試一次。",
};

/**
 * 下載年度 Excel 的按鈕。產生檔案要一點時間，按下後停用並顯示「產生中…」；
 * 下載完重新整理頁面，下面的匯出紀錄才會出現這一筆。
 */
export function DownloadButton({ conferenceId, fileName }: { conferenceId: string; fileName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/staff/years/${conferenceId}/excel`, { method: "POST" });
      // 登入過期時會被導到登入頁，拿回來的是網頁，不是 Excel。
      if (response.redirected || (response.ok && !response.headers.get("X-Export-Id"))) {
        setError("登入已經過期，Excel 沒有下載。請重新整理頁面、重新登入後再下載。");
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: YearExportError } | null;
        setError(ERRORS[body?.error ?? "unavailable"] ?? ERRORS.unavailable);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      // 瀏覽器開始存檔之後才釋放。
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      router.refresh();
    } catch {
      setError("連線中斷，Excel 可能沒有下載完成。請再試一次。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={download}
        disabled={pending}
        aria-busy={pending}
        className={cn(buttonVariants(), buttonClass, "inline-flex items-center gap-2 self-start font-bold disabled:cursor-wait")}
      >
        {pending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
        {pending ? "產生中…" : "下載年度 Excel"}
        <LoadingOverlay show={pending} label="Excel 產生中…" />
      </button>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}
