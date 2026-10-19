import type { ReactNode } from "react";

/** 預覽頁最上方的提示，讓工作人員知道這是預覽、不是訪客看到的頁面。 */
export function PreviewBanner({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-lg border-2 border-primary bg-muted px-4 py-3 font-bold leading-snug">
      {children}
    </p>
  );
}
