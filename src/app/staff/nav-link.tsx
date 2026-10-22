"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";

/**
 * 後台上方選單的連結。後台每一頁都要先向資料庫拿資料，按下後要等一下才換頁，
 * 等的時候蓋住整個畫面轉圈圈，使用者才知道有按到，不會一直重按。籌備委員會公開頁面的選單也用這個。
 */
export function NavLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <Pending />
    </Link>
  );
}

function Pending() {
  const { pending } = useLinkStatus();
  return <LoadingOverlay show={pending} label="載入中…" />;
}
