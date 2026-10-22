import type { Metadata } from "next";
import { Suspense } from "react";
import { CommitteeNav } from "./committee-nav";
import { COMMITTEE_SITE_TITLE, CommitteeShell } from "./committee-shell";

// 名單上有每位姐妹的全名、支聯會與照片，不給搜尋引擎收錄；前台首頁也不連到這裡，由總管理員把網址傳給大家（#74）。
// 分享到 LINE 時的預覽也換成籌備委員會，不沿用報名網站的標題與說明。
const DESCRIPTION = "台灣姐妹大會籌備委員會：大會簡介、主席的話、會議記錄、工作團隊、籌備委員與執行計畫。";
export const metadata: Metadata = {
  title: { default: COMMITTEE_SITE_TITLE, template: `%s｜${COMMITTEE_SITE_TITLE}` },
  description: DESCRIPTION,
  openGraph: { title: COMMITTEE_SITE_TITLE, description: DESCRIPTION },
  robots: { index: false, follow: false },
};

/** 籌備委員會公開頁面（#74）的外框與選單。 */
export default function CommitteeLayout({ children }: LayoutProps<"/committee">) {
  return (
    <CommitteeShell
      nav={
        // 選單讀網址上的年度；這一段等網址讀好才畫，其他部分不用等。
        <Suspense>
          <CommitteeNav />
        </Suspense>
      }
    >
      {children}
    </CommitteeShell>
  );
}
