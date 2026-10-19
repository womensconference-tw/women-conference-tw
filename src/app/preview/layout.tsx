import type { Metadata } from "next";

// 預覽頁只給工作人員看，不給搜尋引擎收錄；proxy 也在回應加上 X-Robots-Tag。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: LayoutProps<"/preview">) {
  return children;
}
