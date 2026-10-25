import Link from "next/link";
import { LanguageSwitch } from "@/components/language-switch";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/** 選單的一個連結。mobile 的連結手機寬度也留在表頭（其他的手機上只在頁尾）。 */
export type SiteLink = { href: string; label: string; mobile?: boolean };

/**
 * 全站表頭（設計交接說明「全站表頭與頁尾」）：網站名稱、選單與 English。首頁與大會特色介紹頁共用。
 * 手機寬度（≤640px，所以斷點寫 641px 而不是 Tailwind 的 sm）表頭只留標了 mobile 的連結與 English，其餘放頁尾，第一屏才不會被選單擠掉。
 * 首頁的網站名稱是頁面標題；其他頁有 home 時，網站名稱連回首頁，頁面標題由頁面自己放。
 * 選單連結（包括 #about 這種頁內錨點）都用 Link：一般連結跳錨點時，瀏覽器記下的歷史紀錄 Next.js 不認得，
 * 之後換到別頁再按上一頁，網址回來了畫面卻沒換回來（#116）。
 */
export function SiteHeader({ t, links, home }: { t: Messages; links: SiteLink[]; home?: string }) {
  const titleClass = "text-lead leading-tight font-bold";
  return (
    <header id="top" data-smooth-scroll className="border-b border-card-outline">
      <div className="mx-auto flex w-full max-w-(--content-max-width) flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3 md:max-w-5xl">
        {home ? (
          <Link href={home} className={`${titleClass} inline-flex min-h-11 items-center`}>
            {t.site.title}
          </Link>
        ) : (
          <h1 className={titleClass}>{t.site.title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {links.length > 0 && (
            <nav aria-label={t.home.navLabel} className={cn(!links.some((link) => link.mobile) && "max-[40.0625rem]:hidden")}>
              <ul className="flex flex-wrap items-center">
                {links.map((link) => (
                  <li key={link.href + link.label} className={cn(!link.mobile && "max-[40.0625rem]:hidden")}>
                    <Link href={link.href} className="inline-flex min-h-11 items-center px-3 font-semibold hover:underline">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <LanguageSwitch />
        </div>
      </div>
    </header>
  );
}

/** 全站頁尾：網站名稱、完整選單（手機兩欄，每個連結至少 44px 高）、回到最上面。 */
export function SiteFooter({ t, links }: { t: Messages; links: SiteLink[] }) {
  return (
    <footer className="bg-foreground text-background">
      <div className="mx-auto flex w-full max-w-(--content-max-width) flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 pt-7 pb-10 md:max-w-5xl">
        <div className="flex flex-col">
          <p className="font-bold">{t.site.title}</p>
          <p>{t.home.church}</p>
        </div>
        {links.length > 0 && (
          <nav aria-label={t.home.footerNavLabel} className="w-full min-[40.0625rem]:w-auto">
            <ul className="grid grid-cols-2 min-[40.0625rem]:flex min-[40.0625rem]:flex-wrap">
              {links.map((link) => (
                <li key={link.href + link.label}>
                  <Link href={link.href} className="inline-flex min-h-11 items-center underline min-[40.0625rem]:px-3">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <Link href="#top" className="inline-flex min-h-11 items-center underline">
          {t.home.backToTop}
        </Link>
      </div>
    </footer>
  );
}
