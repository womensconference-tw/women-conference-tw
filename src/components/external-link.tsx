import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 在新分頁打開的外部連結（Canva、Google 文件等），並告訴讀螢幕軟體的使用者。 */
export function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("break-words underline", className)}>
      {children}
      <span className="sr-only">（在新分頁開啟）</span>
    </a>
  );
}
