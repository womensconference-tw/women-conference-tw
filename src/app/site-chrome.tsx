import Link from "next/link";
import { LanguageSwitch } from "@/components/language-switch";
import type { Messages } from "@/lib/i18n/messages";

/**
 * 網站名稱與語言切換；電腦寬度另有連結（手機上連結太多會擠掉第一屏）。首頁與大會特色介紹頁共用。
 * 首頁的網站名稱是頁面標題；其他頁有 home 時，網站名稱連回首頁，頁面標題由頁面自己放。
 */
export function SiteHeader({
  t,
  links,
  home,
}: {
  t: Messages;
  links: { href: string; label: string }[];
  home?: string;
}) {
  const titleClass = "text-lead leading-tight font-bold";
  return (
    <header id="top" className="border-b border-card-outline">
      <div className="mx-auto flex w-full max-w-(--content-max-width) items-center justify-between gap-4 px-5 py-3 md:max-w-5xl">
        {home ? (
          <Link href={home} className={`${titleClass} inline-flex min-h-11 items-center`}>
            {t.site.title}
          </Link>
        ) : (
          <h1 className={titleClass}>{t.site.title}</h1>
        )}
        <div className="flex items-center gap-2">
          {links.length > 0 && (
            <nav aria-label={t.home.navLabel} className="hidden md:block">
              <ul className="flex items-center">
                {links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="inline-flex min-h-11 items-center px-3 font-semibold hover:underline">
                      {link.label}
                    </a>
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

export function SiteFooter({ t }: { t: Messages }) {
  return (
    <footer className="bg-foreground text-background">
      <div className="mx-auto flex w-full max-w-(--content-max-width) flex-col gap-1 px-5 pt-7 pb-10 md:max-w-5xl">
        <p className="font-bold">{t.site.title}</p>
        <p>{t.home.church}</p>
        <a href="#top" className="inline-flex min-h-11 items-center self-start underline">
          {t.home.backToTop}
        </a>
      </div>
    </footer>
  );
}
