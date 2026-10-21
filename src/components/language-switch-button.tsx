"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "@/components/loading-overlay";
import { Button } from "@/components/ui/button";

/** 切換語言的按鈕。按下後到新語言的頁面出來前停用並蓋住畫面轉圈圈，免得使用者以為沒按到又再按。 */
export function LanguageSwitchButton({
  lang,
  pendingLabel,
  children,
}: {
  lang: string;
  pendingLabel: string;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      lang={lang}
      disabled={pending}
      aria-busy={pending}
      className="h-auto min-h-(--button-min-height) gap-2 px-6 text-(length:--text-body-size)"
    >
      {pending && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
      {children}
      <LoadingOverlay show={pending} label={pendingLabel} />
    </Button>
  );
}
