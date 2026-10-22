"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NavLink } from "./nav-link";

/**
 * 後台上方選單的一項。滑鼠移過去出現底線；目前所在的那一頁（含它底下的頁面，例如報名名單裡的某一筆）
 * 換成藍色並一直有底線，一眼看得出現在在哪裡。「後台首頁」只在 /staff 本身才算。
 */
export function StaffNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const current = href === "/staff" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <NavLink
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "underline-offset-[6px] decoration-2 hover:underline",
        current && "text-blue-700 underline",
      )}
    >
      {children}
    </NavLink>
  );
}
