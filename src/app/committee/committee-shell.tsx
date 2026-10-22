import { Noto_Serif_TC } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { languageTags } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
import { committeeWrapClass } from "./committee-site";

// 標題用的明體。中文字型很大，不預先下載，用到的字才下載。
const serif = Noto_Serif_TC({ weight: ["700"], preload: false, variable: "--font-noto-serif-tc" });

export const COMMITTEE_SITE_TITLE = "台灣姐妹大會籌備委員會";

/**
 * 籌備委員會公開頁面的外框（設計稿 docs/design/committee.html）：頁首有選單，各頁內容在中間，頁尾可以回到頂端。
 * 公開頁面與文字頁草稿的預覽（/preview/committee）共用，預覽才會和發布後的樣子一樣。
 * 內容只有中文；前台選了英文的訪客，網頁的語言（html lang）會是英文，這裡標回中文。
 */
export function CommitteeShell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div id="top" lang={languageTags.zh} className={cn(serif.variable, "flex flex-1 flex-col bg-background text-[#1f2933]")}>
      <header className="border-b border-committee-line">
        <div className={cn(committeeWrapClass, "flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-[18px]")}>
          <Link href="/committee" className="flex flex-col gap-0.5 text-[#1f2933] no-underline">
            <span className="font-committee-serif text-xl font-bold tracking-[.04em]">{COMMITTEE_SITE_TITLE}</span>
            <span className="text-xs text-committee-text-3">耶穌基督後期聖徒教會</span>
          </Link>
          {nav}
        </div>
      </header>
      <main className={cn(committeeWrapClass, "flex-1 pt-10 pb-16 sm:pt-14 sm:pb-[72px]")}>{children}</main>
      <footer className="border-t border-committee-line bg-committee-soft">
        <div className={cn(committeeWrapClass, "flex flex-wrap justify-between gap-3 py-7 text-sm text-committee-text-2")}>
          <span>{COMMITTEE_SITE_TITLE}</span>
          <a href="#top" className="text-committee hover:text-committee-hover">
            回到頂端
          </a>
        </div>
      </footer>
    </div>
  );
}
