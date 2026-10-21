"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { buttonVariants } from "@/components/ui/button";
import type { StaffExportError, StaffExportKind } from "@/lib/staff-export";
import { cn } from "@/lib/utils";
import { alertClass, buttonClass } from "../../ui";

const LABELS: Record<StaffExportKind, string> = {
  badges: "下載名牌 CSV",
  roster: "下載範圍內名單 CSV",
  full_roster: "下載完整名單 CSV",
  stake_summary: "下載支聯會簡表 CSV",
};

const ERRORS: Record<StaffExportError, string> = {
  not_allowed: "你沒有下載這份檔案的權限。請重新整理頁面；還是不行請聯絡總管理員。",
  not_found: "找不到這個年度，請重新整理頁面再試一次。",
};

/**
 * 下載 CSV 的按鈕（#20），只顯示自己角色能用的幾種（檔名由頁面給）。產生檔案要一點時間，按下後停用並顯示「產生中…」。
 */
export function ExportButtons({
  exports,
  year,
}: {
  exports: { kind: StaffExportKind; fileName: string }[];
  year: number;
}) {
  const [pending, setPending] = useState<StaffExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(kind: StaffExportKind, fileName: string) {
    setPending(kind);
    setError(null);
    try {
      const response = await fetch(`/staff/registrations/export?kind=${kind}&year=${year}`);
      // 登入過期時會被導到登入頁，拿回來的是網頁，不是 CSV。
      if (response.redirected || (response.ok && !response.headers.get("Content-Type")?.startsWith("text/csv"))) {
        setError("登入已經過期，檔案沒有下載。請重新整理頁面、重新登入後再下載。");
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: StaffExportError } | null;
        setError((body?.error && ERRORS[body.error]) ?? "系統暫時出了問題，檔案沒有產生。請稍後再試一次。");
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
    } catch {
      setError("連線中斷，檔案可能沒有下載完成。請再試一次。");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {exports.map(({ kind, fileName }) => (
          <button
            key={kind}
            type="button"
            onClick={() => download(kind, fileName)}
            disabled={pending !== null}
            aria-busy={pending === kind}
            className={cn(
              buttonVariants({ variant: "outline" }),
              buttonClass,
              "inline-flex items-center gap-2 font-bold disabled:cursor-wait",
            )}
          >
            {pending === kind && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            {pending === kind ? "產生中…" : LABELS[kind]}
            <LoadingOverlay show={pending === kind} label="檔案產生中…" />
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}
