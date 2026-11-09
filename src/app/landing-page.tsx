import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference, homePhase, type CurrentConference } from "@/lib/conference";
import { CONFERENCE_SITE_URL } from "@/lib/conference-site";
import { languageTags, type Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PreviewBanner } from "./preview/preview-banner";

// 預覽的報名按鈕連到預覽報名表，工作人員點了不會真的報名。
const registerPaths = { live: "/register", preview: "/preview/register" };
// 代報的報名表：同一份表單，第一步多一句說明（見 RegisterPage）。
const proxyQuery = "?for=others";
const lookupPath = "/lookup";

// 按鈕高度、字級來自 globals.css 的設定；文字太長時換行而不是被截掉。
// 經過 cn() 的字級要寫成 text-(length:…)：寫 text-body 會被誤認成文字顏色，蓋掉按鈕的文字色。
const actionClass =
  "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal text-center";
const primaryActionClass = "min-h-(--button-primary-min-height) text-(length:--text-lead-size) font-bold";

/*
 * 報名入口頁（ADR 0012）：大會名稱、日期與時間 → 報名狀態 → 我要報名、幫家人或朋友報名、查詢或修改報名 → 大會網站連結。
 * 報名狀態與「我要報名」要在 375×667 手機（含 LINE 內建瀏覽器的工具列）的第一屏，所以沒有主視覺、沒有選單；
 * 上方和報名表、查詢頁一樣只有語言切換，不放全站表頭（英文的網站名稱會折成兩三行，把「我要報名」擠出第一屏）。
 * 不在報名期間不顯示報名與代報按鈕；報名前也沒有查詢（還沒有人報名），已截止只能查詢。
 * 前台（/）與後台的預覽（/preview）共用：預覽時最上方有提示，公告上線前也照報名前的樣子顯示（見 homePhase）。
 */
export async function LandingPage({ preview }: { preview: boolean }) {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const conference = await getCurrentConference(supabase, new Date());
  const phase = homePhase(conference, { preview });
  const registerPath = preview ? registerPaths.preview : registerPaths.live;

  return (
    <>
      {preview && (
        <div className="px-5 pt-3">
          <PreviewBanner>
            {conference?.phase === "unannounced" ? t.preview.homeNotAnnounced : t.preview.homeAnnounced}
          </PreviewBanner>
        </div>
      )}
      <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-6 px-5 pt-3 pb-12 text-body leading-relaxed">
        {/* 頁尾「回到最上面」跳到這裡。 */}
        <div id="top" className="flex justify-end">
          <LanguageSwitch />
        </div>
        {!conference || !phase ? (
          <p>{t.landing.comingSoon}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-heading leading-tight font-bold">{t.landing.title(conference.year)}</h1>
              <p className="flex flex-wrap gap-x-4">
                <strong>{formatDay(conferenceDay(conference.conferenceDate), locale)}</strong>
                {conference.startTime && <span>{conferenceTime(conference, conference.startTime, t, locale)}</span>}
              </p>
            </div>
            <RegistrationStatus conference={conference} phase={phase} t={t} locale={locale} />
            {phase === "open" && (
              <div className="flex flex-col gap-3">
                <ActionLink href={registerPath} className={primaryActionClass}>
                  {t.landing.registerButton}
                </ActionLink>
                <ActionLink href={registerPath + proxyQuery} variant="outline">
                  {t.landing.proxyButton}
                </ActionLink>
                <ActionLink href={lookupPath} variant="outline">
                  {t.landing.lookupButton}
                </ActionLink>
                {conference.registrationClosesAt && (
                  <p>{t.landing.canChangeUntil(formatDay(lastDay(conference.registrationClosesAt), locale))}</p>
                )}
              </div>
            )}
            {/* 截止後網站上不能修改，按鈕只寫「查詢」。 */}
            {phase === "closed" && (
              <ActionLink href={lookupPath} className={primaryActionClass}>
                {t.landing.lookupOnlyButton}
              </ActionLink>
            )}
            {/* 站外網址用一般連結，同一個分頁開。 */}
            <a href={CONFERENCE_SITE_URL} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
              {t.landing.conferenceSite}
              <span aria-hidden>&nbsp;→</span>
            </a>
          </>
        )}
      </main>
      <Footer t={t} />
    </>
  );
}

/** 頁尾：網站名稱、教會名稱、回到最上面。 */
function Footer({ t }: { t: Messages }) {
  return (
    <footer className="bg-foreground text-background">
      <div className="mx-auto flex w-full max-w-(--content-max-width) flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 pt-7 pb-10">
        <div className="flex flex-col">
          <p className="font-bold">{t.site.title}</p>
          <p>{t.landing.church}</p>
        </div>
        <Link href="#top" className="inline-flex min-h-11 items-center underline">
          {t.landing.backToTop}
        </Link>
      </div>
    </footer>
  );
}

type Phase = NonNullable<ReturnType<typeof homePhase>>;

/** 報名狀態卡：報名前寫開放與截止時間，報名中寫截止時間，已截止說明只能查詢。日期都來自後台的報名開放、截止時間。 */
function RegistrationStatus({
  conference,
  phase,
  t,
  locale,
}: {
  conference: CurrentConference;
  phase: Phase;
  t: Messages;
  locale: Locale;
}) {
  const { registrationOpensAt: opensAt, registrationClosesAt: closesAt } = conference;
  return (
    <section id="status" className="flex flex-col gap-1 rounded-lg bg-muted p-5">
      {phase === "upcoming" && (
        <>
          <h2 className="text-lead font-bold">{t.landing.notOpenHeading}</h2>
          {opensAt ? (
            <p className="font-semibold">{t.landing.opensOn(formatDayTime(opensAt, locale))}</p>
          ) : (
            <p>{t.landing.registrationOpensSoon}</p>
          )}
          {closesAt && <p>{t.landing.closesOn(formatDayTime(closesAt, locale))}</p>}
        </>
      )}
      {phase === "open" && (
        <>
          <h2 className="text-lead font-bold">{t.landing.openHeading}</h2>
          {closesAt && <p>{t.landing.closesOn(formatDayTime(closesAt, locale))}</p>}
        </>
      )}
      {phase === "closed" && (
        <>
          <h2 className="text-lead font-bold">{t.landing.closedHeading}</h2>
          <p>{t.landing.closedDescription}</p>
        </>
      )}
    </section>
  );
}

/** 寫完整文字的大按鈕，一律用 Link（同一個分頁開，不開彈出視窗）；站外網址 Link 會交給瀏覽器直接換頁。 */
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
  return (
    <Link href={href} className={cn(buttonVariants({ variant }), actionClass, className)}>
      {children}
    </Link>
  );
}

function conferenceTime(conference: CurrentConference, start: string, t: Messages, locale: Locale): string {
  const at = (hhmm: string) => formatTime(new Date(`${conference.conferenceDate}T${hhmm}:00+08:00`), locale);
  return conference.endTime
    ? t.landing.conferenceTime(at(start), at(conference.endTime))
    : t.landing.conferenceStartsAt(at(start));
}

// conference_date is a calendar date (YYYY-MM-DD), not an instant; anchor it at noon Taiwan time.
function conferenceDay(date: string): Date {
  return new Date(`${date}T12:00:00+08:00`);
}

// 截止時間是 1/14 00:00 時，姐妹可以改到 1/13 為止，只寫日期時寫 1/13。
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

function formatTime(moment: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], { timeZone: TAIPEI, hour: "numeric", minute: "2-digit" }).format(
    moment,
  );
}

function formatDayTime(moment: Date, locale: Locale): string {
  return `${formatDay(moment, locale)} ${formatTime(moment, locale)}`;
}
