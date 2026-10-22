"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { NavLink } from "@/app/staff/nav-link";
import { cn } from "@/lib/utils";
import { COMMITTEE_PAGES } from "./committee-routes";

/** 選單上的一項。changed 是草稿預覽時這一頁有尚未發布的修改。 */
export type CommitteeNavItem = { label: string; href: string; current: boolean; changed?: boolean };

/**
 * 選單：標出目前這一頁（籌備委員的個人頁算在「籌備委員」底下）。看過去的年度時，換頁照樣停在那個年度。
 * 最後一項「大會網站」連到前台首頁。
 */
export function CommitteeNav() {
  const pathname = usePathname();
  const query = useYearQuery();

  return (
    <CommitteeNavList
      items={COMMITTEE_PAGES.map((page) => ({
        label: page.label,
        href: `${page.href}${query}`,
        current: page.href === "/committee" ? pathname === page.href : pathname === page.href || pathname.startsWith(`${page.href}/`),
      }))}
    />
  );
}

/** 頁首的網站標題，連到大會簡介；看過去的年度時照樣停在那個年度（Codex 審查）。 */
export function CommitteeHomeLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Link href={`/committee${useYearQuery()}`} className={className}>
      {children}
    </Link>
  );
}

// 網址上選的年度，換頁時要帶著。格式不對時（網址被改過）不帶，回到目前年度。
function useYearQuery(): string {
  const year = useSearchParams().get("year");
  return year && /^\d{4}$/.test(year) ? `?year=${year}` : "";
}

/**
 * 選單的樣子，公開頁面與文字頁草稿的預覽（/preview/committee）共用。
 * 每一頁都要先向資料庫拿資料，換頁時蓋住整個畫面轉圈圈（NavLink）。
 */
export function CommitteeNavList({ items }: { items: CommitteeNavItem[] }) {
  return (
    <nav aria-label="籌備委員會選單" className="flex flex-wrap gap-1">
      {[...items, { label: "大會網站", href: "/", current: false }].map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-1.5 rounded-md px-3 text-[15px] text-[#3e4c59] no-underline hover:bg-committee-soft",
            item.current && "bg-committee font-medium text-white hover:bg-committee",
          )}
        >
          {item.label}
          {"changed" in item && item.changed && (
            <>
              <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />
              <span className="sr-only">（有修改）</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
