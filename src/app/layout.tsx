import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { languageTags, type Locale } from "@/lib/i18n/locale";
import { getLocale, getMessages } from "@/lib/i18n/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 分享預覽圖是同一資料夾的 opengraph-image.png；網址的網域在 Vercel 上由 Next.js 自動帶入。
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getMessages();
  return {
    title: t.site.title,
    description: t.site.description,
    openGraph: {
      type: "website",
      title: t.site.title,
      description: t.site.description,
      siteName: t.site.title,
      locale: ogLocales[locale],
    },
    twitter: { card: "summary_large_image" },
  };
}

const ogLocales: Record<Locale, string> = { zh: "zh_TW", en: "en_US" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html
      lang={languageTags[locale]}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
