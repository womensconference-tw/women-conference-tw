import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference, homePhase, type CurrentConference, type SchedulePhase } from "@/lib/conference";
import { getHomeContent, showAdminContact, type HomeContent } from "@/lib/home-content";
import { languageTags, type Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { HomeAgenda } from "./home-agenda";
import { PreviewBanner } from "./preview/preview-banner";
import { SiteFooter, SiteHeader, type SiteLink } from "./site-chrome";

// 預覽首頁的報名按鈕連到預覽報名表，工作人員點了不會真的報名。
const registerPaths = { live: "/register", preview: "/preview/register" };
// 代報的報名表：同一份表單，第一步多一句說明（見 RegisterPage）。
const proxyQuery = "?for=others";
const lookupPath = "/lookup";
// 大會特色的介紹頁；預覽首頁連到預覽版，公告上線前也看得到。
const highlightPaths = { live: "/highlights/", preview: "/preview/highlights/" };

// 按鈕高度、字級來自 globals.css 的主視覺設定；文字太長時換行而不是被截掉。
// 經過 cn() 的字級要寫成 text-(length:…)：寫 text-body 會被誤認成文字顏色，蓋掉按鈕的文字色。
const actionClass =
  "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal text-center";
const primaryActionClass =
  "min-h-(--button-primary-min-height) text-(length:--text-lead-size) font-bold";

/*
 * 首頁區塊順序照美編組的設計稿（ADR 0010，手機與電腦相同）：Header → 主視覺 → 狀態列（日期、時間、三地同步、
 * 報名狀態與「前往報名」）→ 歡迎詞 → 大會有什麼 → 大會程序 → 報名參加 → 常見問題 → 需要幫忙 → 自訂區塊 → Footer。
 * 設計稿沒有常見問題與自訂區塊，沒有內容時不顯示。不用下拉選單、不用輪播。
 * 前台首頁（/）與後台的預覽首頁（/preview）共用：預覽時最上方有提示，公告上線前也照報名前的樣子顯示（見 homePhase）。
 */
export async function HomePage({ preview }: { preview: boolean }) {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const [conference, content] = await Promise.all([
    getCurrentConference(supabase, new Date()),
    getHomeContent(supabase, locale),
  ]);
  const phase = homePhase(conference, { preview });
  const registerPath = preview ? registerPaths.preview : registerPaths.live;
  const highlightPath = preview ? highlightPaths.preview : highlightPaths.live;
  const shown = conference && content && phase ? { conference, content, phase } : null;
  const hasAbout = !!shown && (!!shown.content.welcome || shown.content.highlights.length > 0);
  const hasAgenda = !!shown && shown.content.venues.length > 0;
  // 「大會場地」還沒有自己的頁面，先連到大會程序（有地址與地圖）。手機上報名入口在狀態列，表頭只留 English。
  const links: SiteLink[] = shown
    ? [
        hasAbout && { href: "#about", label: t.home.navAbout },
        hasAgenda && { href: "#agenda", label: t.home.navAgenda },
        hasAgenda && { href: "#agenda", label: t.home.navVenues },
        { href: "#register", label: t.home.navRegister },
        showAdminContact && { href: "#help", label: t.home.navHelp },
      ].filter((link) => !!link)
    : [];

  return (
    <>
      {preview && (
        <div className="px-5 pt-3">
          <PreviewBanner>
            {conference?.phase === "unannounced" ? t.preview.homeNotAnnounced : t.preview.homeAnnounced}
          </PreviewBanner>
        </div>
      )}
      <SiteHeader t={t} links={links} />
      <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-12 px-5 pb-12 text-body leading-relaxed md:max-w-5xl">
        {!shown ? (
          <p className="pt-6">{t.home.comingSoon}</p>
        ) : (
          <>
            {/* 主視覺與狀態列貼在一起，是第一屏。 */}
            <div className="-mx-5 flex flex-col md:mx-0">
              <HeroArea content={shown.content} t={t} locale={locale} />
              <StatusBar {...shown} t={t} locale={locale} />
            </div>
            {hasAbout && (
              <div id="about" className="grid scroll-mt-4 gap-12 md:grid-cols-2">
                <WelcomeSection content={shown.content} t={t} />
                <HighlightsSection content={shown.content} path={highlightPath} t={t} />
              </div>
            )}
            {hasAgenda && <HomeAgenda venues={shown.content.venues} locale={locale} highlightPath={highlightPath} />}
            <RegisterSection {...shown} registerPath={registerPath} t={t} locale={locale} />
            <FaqSection content={shown.content} t={t} />
            {showAdminContact && <HelpSection content={shown.content} t={t} />}
            {shown.content.customBlocks.map((block, index) => (
              <Section key={index} heading={block.title}>
                {block.body && <p className="whitespace-pre-line">{block.body}</p>}
                {block.button && (
                  <ActionLink href={block.button.url} variant="outline">
                    {block.button.label}
                  </ActionLink>
                )}
              </Section>
            ))}
          </>
        )}
      </main>
      <SiteFooter t={t} links={links} />
    </>
  );
}

type SectionProps = { t: Messages };
type ShownPhase = Exclude<SchedulePhase, "unannounced">;
type PhaseProps = SectionProps & {
  conference: CurrentConference;
  phase: ShownPhase;
  content: HomeContent;
  locale: Locale;
};

/**
 * 第一屏的主視覺：有圖時顯示圖（圖裡已經有主題經文），沒有圖時用文字顯示主題經文。
 * 只有電腦版的圖時，手機上看不到圖，主題經文只在手機上用文字顯示。
 */
function HeroArea({ content, t, locale }: SectionProps & { content: HomeContent; locale: Locale }) {
  const themeScripture = content.hero?.mobileUrl ? null : content.themeScripture;
  return (
    <>
      {content.hero && <HeroImage hero={content.hero} locale={locale} />}
      {themeScripture?.text && (
        <figure className={cn("flex flex-col gap-2 bg-muted px-5 py-8 md:rounded-lg", content.hero && "md:hidden")}>
          <figcaption className="font-bold">{t.home.themeScriptureHeading}</figcaption>
          <blockquote className="border-l-4 border-quote-line pl-4 text-lead leading-snug">
            <p className="whitespace-pre-line">{themeScripture.text}</p>
            {themeScripture.reference && <p className="mt-2 text-body">— {themeScripture.reference}</p>}
          </blockquote>
        </figure>
      )}
    </>
  );
}

// 375 寬的手機上，英文的網站名稱和狀態列第一行都會折成兩行，要多留一點。
const heroMaxHeight: Record<Locale, string> = {
  zh: "[--hero-reserve:11rem]",
  en: "[--hero-reserve:16rem]",
};

// 1×1 透明的圖：只有電腦版主視覺時給手機用，瀏覽器不用另外下載。
const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * 主視覺（#81）：手機寬度用手機版、電腦寬度用電腦版；用 <picture>，手機不會下載電腦版的大圖。
 * 缺圖時用哪一張已經在 pickHeroPaths 挑好；電腦版用的是手機版的圖時置中，不拉伸變形。
 * 只有電腦版的圖時，手機上整張隱藏（給的是透明的小圖，不會下載電腦版），改用文字顯示主題經文（HeroArea）。
 * 高度最多是一屏扣掉 Header 與狀態列第一行，LINE 內建瀏覽器的工具列也算進去，「前往報名」才在第一屏（ADR 0010）。
 */
function HeroImage({ hero, locale }: { hero: NonNullable<HomeContent["hero"]>; locale: Locale }) {
  return (
    <picture className={hero.mobileUrl ? undefined : "hidden md:block"}>
      {/* 和 Tailwind 的 md（48rem）同一個寬度，使用者把瀏覽器字級調大時，隱藏與不下載的寬度才一致（Codex 審查）。 */}
      <source media="(min-width: 48rem)" srcSet={hero.desktopUrl} />
      {/* 存放空間的公開網址，美編組已經做好尺寸，不經過 Next.js 的圖片最佳化。 */}
      <img
        src={hero.mobileUrl ?? BLANK_IMAGE}
        alt={hero.alt}
        fetchPriority="high"
        className={cn("hero-max-h mx-auto block h-auto w-auto max-w-full object-contain md:rounded-lg", heroMaxHeight[locale])}
      />
    </picture>
  );
}

/**
 * 狀態列：依時期切換的報名狀態，以及日期、時間、三地同步。按鈕都捲到下面的「報名參加」（ADR 0010）。
 * 設計稿的日期在報名狀態上面；三個教堂的完整名稱會佔兩三行，有主視覺圖時會把「前往報名」擠出第一屏，所以報名狀態放上面。
 */
function StatusBar({ conference, phase, content, t, locale }: PhaseProps) {
  const places = new Intl.ListFormat(languageTags[locale], { type: "conjunction" }).format(
    content.venues.map((venue) => venue.name),
  );
  const closesAt = conference.registrationClosesAt;
  return (
    <section className="flex flex-col gap-3 border-b border-card-outline px-5 py-4 md:px-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-bold">
          {phase === "upcoming" &&
            (conference.registrationOpensAt
              ? t.home.statusOpensOn(formatDay(conference.registrationOpensAt, locale))
              : t.home.registrationOpensSoon)}
          {phase === "open" &&
            (closesAt ? t.home.statusOpenUntil(formatShortDay(lastDay(closesAt), locale)) : t.home.statusOpen)}
          {phase === "closed" && t.home.registrationClosed}
        </p>
        {phase === "open" && <ActionLink href="#register">{t.home.goToRegister}</ActionLink>}
        {phase === "closed" && (
          <ActionLink href="#register" variant="outline">
            {t.home.lookupButton}
          </ActionLink>
        )}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <strong>{formatDay(conferenceDay(conference.conferenceDate), locale)}</strong>
        {content.time && <span>{conferenceTime(conference, content.time, t, locale)}</span>}
        {content.venues.length > 0 && <span>{t.home.simultaneous(places)}</span>}
      </p>
    </section>
  );
}

function WelcomeSection({ content, t }: SectionProps & { content: HomeContent }) {
  if (!content.welcome) return null;
  return (
    <Section heading={t.home.welcomeHeading}>
      <p className="whitespace-pre-line">{content.welcome}</p>
      {content.welcomeSignature && <p className="text-right">{content.welcomeSignature}</p>}
    </Section>
  );
}

/** 大會有什麼：每項大會特色一張卡片。寫了介紹內容的整張卡片可以點，連到介紹頁；沒寫的只是文字，不能點。 */
function HighlightsSection({ content, path, t }: SectionProps & { content: HomeContent; path: string }) {
  if (content.highlights.length === 0) return null;
  const cardClass = "flex h-full flex-col gap-1 rounded-lg border-2 border-card-outline p-4";
  return (
    <Section heading={t.home.highlightsHeading}>
      <ul className="grid grid-cols-2 gap-3">
        {content.highlights.map((highlight) => {
          const text = (
            <>
              <h3 className="font-bold">{highlight.name}</h3>
              {highlight.summary && <p className="text-muted-foreground">{highlight.summary}</p>}
            </>
          );
          return (
            <li key={highlight.id}>
              {highlight.linkable ? (
                <Link href={path + highlight.id} className={cn(cardClass, "hover:bg-muted")}>
                  {text}
                  <span aria-hidden className="mt-auto pt-1 font-semibold text-primary underline">
                    {t.home.highlightMore} →
                  </span>
                </Link>
              ) : (
                <div className={cardClass}>{text}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * 報名參加：報名前只有說明卡（開放當天才出現按鈕）；報名中有三步驟、我要報名、幫家人或朋友報名（ADR 0003）、
 * 已報名查詢；已截止只能查詢。
 */
function RegisterSection({ conference, phase, t, locale, registerPath }: PhaseProps & { registerPath: string }) {
  const { registrationOpensAt: opensAt, registrationClosesAt: closesAt } = conference;
  return (
    <Section id="register" heading={t.home.registerHeading}>
      {phase === "upcoming" && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-5">
          <h3 className="text-lead font-bold">{t.home.notOpenHeading}</h3>
          {opensAt && <p className="font-semibold">{t.home.opensOn(formatDayTime(opensAt, locale))}</p>}
          {closesAt && <p>{t.home.closesOn(formatDayTime(closesAt, locale))}</p>}
          <p>{t.home.notOpenHint}</p>
        </div>
      )}
      {phase === "open" && (
        <>
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-5">
            <h3 className="text-lead font-bold">{t.home.openHeading}</h3>
            {closesAt && <p>{t.home.closesOn(formatDayTime(closesAt, locale))}</p>}
          </div>
          <ol className="flex flex-col gap-3">
            {t.home.steps.map((step, index) => (
              <li key={index} className="flex gap-4">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground"
                >
                  {index + 1}
                </span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
          </ol>
          <ActionLink href={registerPath} className={primaryActionClass}>
            {t.home.registerButton}
          </ActionLink>
          <div className="flex flex-col gap-2">
            <ActionLink href={registerPath + proxyQuery} variant="outline">
              {t.home.proxyButton}
            </ActionLink>
            <p>{t.home.proxyDescription}</p>
          </div>
          <div className="mt-2 flex flex-col gap-3 border-t border-card-outline pt-5">
            <h3 className="text-lead font-bold">{t.home.lookupHeading}</h3>
            <p>
              {t.home.lookupDescription}
              {/* 英文句子之間要空一格，中文不用。 */}
              {closesAt && (locale === "en" ? " " : "") + t.home.canChangeUntil(formatDay(lastDay(closesAt), locale))}
            </p>
            <ActionLink href={lookupPath} variant="outline">
              {t.home.lookupOrChangeButton}
            </ActionLink>
          </div>
        </>
      )}
      {phase === "closed" && (
        <>
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-5">
            <h3 className="text-lead font-bold">{t.home.closedHeading}</h3>
            <p>{t.home.closedDescription}</p>
          </div>
          <ActionLink href={lookupPath} className={primaryActionClass}>
            {t.home.lookupButton}
          </ActionLink>
        </>
      )}
    </Section>
  );
}

function FaqSection({ content, t }: SectionProps & { content: HomeContent }) {
  if (content.faqs.length === 0) return null;
  return (
    <Section heading={t.home.faqHeading}>
      <dl className="flex flex-col gap-4">
        {content.faqs.map((faq, index) => (
          <div key={index}>
            <dt className="font-semibold">{faq.question}</dt>
            <dd className="whitespace-pre-line">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function HelpSection({ content, t }: SectionProps & { content: HomeContent }) {
  return (
    <Section id="help" heading={t.home.helpHeading}>
      {content.adminLine ? (
        <>
          <p>{t.home.helpDescription}</p>
          <p className="font-semibold">{t.home.helpLineId(content.adminLine.id)}</p>
          <ActionLink href={content.adminLine.url} variant="outline">
            {t.home.helpLineButton}
          </ActionLink>
        </>
      ) : (
        <p>{t.home.helpLineComingSoon}</p>
      )}
    </Section>
  );
}

function Section({ id, heading, children }: { id?: string; heading: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-4">
      <h2 className="text-heading font-bold">{heading}</h2>
      {children}
    </section>
  );
}

/**
 * 寫完整文字的大按鈕，一律用 Link（同一個分頁開，不開彈出視窗）。頁內錨點用一般連結會讓上一頁失靈（見 SiteHeader），
 * 自訂區塊也可能填本站的完整網址加錨點；站外網址 Link 會交給瀏覽器直接換頁。
 */
function ActionLink({
  href,
  variant = "default",
  className,
  children,
}: {
  href: string;
  variant?: "default" | "outline";
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(buttonVariants({ variant }), actionClass, className);
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

function conferenceTime(
  conference: CurrentConference,
  time: NonNullable<HomeContent["time"]>,
  t: Messages,
  locale: Locale,
): string {
  const at = (hhmm: string) => formatTime(new Date(`${conference.conferenceDate}T${hhmm}:00+08:00`), locale);
  return time.end ? t.home.conferenceTime(at(time.start), at(time.end)) : t.home.conferenceStartsAt(at(time.start));
}

// conference_date is a calendar date (YYYY-MM-DD), not an instant; anchor it at noon Taiwan time.
function conferenceDay(date: string): Date {
  return new Date(`${date}T12:00:00+08:00`);
}

// 截止時間是 1/14 00:00 時，姐妹可以報到 1/13 為止，只寫日期時寫 1/13。
function lastDay(closesAt: Date): Date {
  return new Date(closesAt.getTime() - 1);
}

const TAIPEI = "Asia/Taipei";

// 「12月26日（星期五）」；英文是「Friday, December 26」。
function formatDay(moment: Date, locale: Locale): string {
  const tag = languageTags[locale];
  if (locale === "en") {
    return new Intl.DateTimeFormat(tag, { timeZone: TAIPEI, weekday: "long", month: "long", day: "numeric" }).format(moment);
  }
  const day = new Intl.DateTimeFormat(tag, { timeZone: TAIPEI, month: "long", day: "numeric" }).format(moment);
  const weekday = new Intl.DateTimeFormat(tag, { timeZone: TAIPEI, weekday: "long" }).format(moment);
  return `${day}（${weekday}）`;
}

// 狀態列的「截止 1/13」；英文寫月份名稱（Jan 13），外國姐妹不會把日、月看反。
function formatShortDay(moment: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], {
    timeZone: TAIPEI,
    month: locale === "en" ? "short" : "numeric",
    day: "numeric",
  }).format(moment);
}

function formatTime(moment: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], { timeZone: TAIPEI, hour: "numeric", minute: "2-digit" }).format(
    moment,
  );
}

function formatDayTime(moment: Date, locale: Locale): string {
  return `${formatDay(moment, locale)} ${formatTime(moment, locale)}`;
}
