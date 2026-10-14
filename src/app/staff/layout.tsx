import type { Metadata } from "next";

// 後台不給搜尋引擎收錄；proxy 也在回應加上 X-Robots-Tag。首頁不放連到後台的連結。
export const metadata: Metadata = {
  title: { template: "%s｜台灣姐妹大會後台", default: "台灣姐妹大會後台" },
  robots: { index: false, follow: false },
};

/** 後台只給工作人員用，畫面只有中文。 */
export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return (
    <div lang="zh-Hant-TW" className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
      {children}
    </div>
  );
}
