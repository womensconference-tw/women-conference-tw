"use client";

import { LoaderCircle } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

/**
 * 後台上方選單的連結。後台每一頁都要先向資料庫拿資料，按下後要等一下才換頁，
 * 等的時候在文字右邊轉圈圈，使用者才知道有按到，不會一直重按。
 * 轉圈圈的位置一開始就留好，出現時旁邊的連結不會被擠動。
 */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="relative pr-5">
      {children}
      <Pending />
    </Link>
  );
}

function Pending() {
  const { pending } = useLinkStatus();
  return (
    <LoaderCircle
      aria-hidden
      className={`absolute top-1/2 right-0 size-4 -translate-y-1/2 animate-spin ${pending ? "" : "invisible"}`}
    />
  );
}
