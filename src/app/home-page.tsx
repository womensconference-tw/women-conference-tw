import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference, homePhase, type CurrentConference, type SchedulePhase } from "@/lib/conference";
import { getHomeContent, type HomeContent } from "@/lib/home-content";
import { languageTags, type Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PreviewBanner } from "./preview/preview-banner";

// 預覽首頁的報名按鈕連到預覽報名表，工作人員點了不會真的報名。
const registerPaths = { live: "/register", preview: "/preview/register" };
// 代報的報名表：同一份表單，第一步多一句說明（見 RegisterPage）。
const proxyQuery = "?for=others";
const lookupPath = "/lookup";

// 按鈕高度、字級來自 globals.css 的主視覺設定；文字太長時換行而不是被截掉。
// 經過 cn() 的字級要寫成 text-(length:…)：寫 text-body 會被誤認成文字顏色，蓋掉按鈕的文字色。
const actionClass =
  "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal text-center";
const primaryActionClass =
  "min-h-(--button-primary-min-height) text-(length:--text-lead-size) font-bold";

/*
 * 首頁區塊順序依規格：報名 → 幫家人或朋友報名（報名中才有）→ 已報名查詢 → 報名三步驟 → 場地 → 需要幫忙 → 關於大會，
 * 自訂區塊接在最後。不用下拉選單、不用輪播，所有內容直接攤開。
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

  return (
    <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-12 px-5 pt-3 pb-8 text-body leading-relaxed">
      {preview && (
        <PreviewBanner>
          {conference?.phase === "unannounced" ? t.preview.homeNotAnnounced : t.preview.homeAnnounced}
        </PreviewBanner>
      )}
      {!conference || !content || !phase ? (
        <section className="flex flex-col gap-3">
          <div className="flex justify-end">
            <LanguageSwitch />
          </div>
          <h1 className="text-title leading-tight font-bold">{t.site.title}</h1>
          <p>{t.home.comingSoon}</p>
        </section>
      ) : (
        <>
          <RegistrationSection
            conference={conference}
            phase={phase}
            content={content}
            registerPath={registerPath}
            t={t}
            locale={locale}
          />
          {phase === "open" && <ProxySection href={registerPath + proxyQuery} t={t} />}
          {/* 已截止時第一屏已經是查詢按鈕，也不能再報名，這兩區就不重複顯示。 */}
          {phase !== "closed" && (
            <>
              <LookupSection t={t} />
              <StepsSection t={t} />
            </>
          )}
          <VenuesSection content={content} t={t} />
          <HelpSection content={content} t={t} />
          <AboutSection content={content} t={t} />
          {content.customBlocks.map((block, index) => (
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
  );
}

type SectionProps = { t: Messages };
type ShownPhase = Exclude<SchedulePhase, "unannounced">;

/**
 * 第一屏：日期、時間、報名狀態、最大的「我要報名」與三地同步。
 * 小手機（375×667）、英文版、LINE 內建瀏覽器的工具列都算進去，按鈕還是要在第一屏看得到，
 * 所以這裡間距收緊、次要的字用內文字級，場地名稱放在按鈕下方（英文名稱很長，會佔四行）。
 */
function RegistrationSection({
  conference,
  phase,
  content,
  registerPath,
  t,
  locale,
}: SectionProps & {
  conference: CurrentConference;
  phase: ShownPhase;
  content: HomeContent;
  registerPath: string;
  locale: Locale;
}) {
  const places = new Intl.ListFormat(languageTags[locale], { type: "conjunction" }).format(
    content.venues.map((venue) => venue.name),
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <h1 className="text-title leading-tight font-bold">{t.site.title}</h1>
      <p className="text-lead leading-snug font-semibold">
        {t.home.conferenceDate(
          conference.year,
          formatConferenceDate(conference.conferenceDate, locale),
        )}
      </p>
      {content.time && (
        <p>
          {content.time.end
            ? t.home.conferenceTime(
                formatTime(conference.conferenceDate, content.time.start, locale),
                formatTime(conference.conferenceDate, content.time.end, locale),
              )
            : t.home.conferenceStartsAt(
                formatTime(conference.conferenceDate, content.time.start, locale),
              )}
        </p>
      )}
      <p className="font-semibold">{statusText(conference, phase, t, locale)}</p>
      {phase === "open" && (
        <ActionLink href={registerPath} className={primaryActionClass}>
          {t.home.registerButton}
        </ActionLink>
      )}
      {phase === "upcoming" && (
        // 報名前按鈕不可用。不用半透明，文字才保有高對比。
        <button
          type="button"
          disabled
          className={cn(
            buttonVariants({ variant: "secondary" }),
            actionClass,
            primaryActionClass,
            "border-2 border-dashed border-foreground/40 disabled:opacity-100",
          )}
        >
          {t.home.registerNotOpenYet}
        </button>
      )}
      {phase === "closed" && (
        <>
          <p>{t.home.closedCanStillLookUp}</p>
          <ActionLink href={lookupPath} className={primaryActionClass}>
            {t.home.lookupButton}
          </ActionLink>
        </>
      )}
      {content.venues.length > 0 && <p>{t.home.simultaneous(places)}</p>}
    </section>
  );
}

/** 代報人的入口（ADR 0003）：說明可以用自己的電話幫別人報名，報完一位可以接著報下一位。 */
function ProxySection({ href, t }: SectionProps & { href: string }) {
  return (
    <Section heading={t.home.proxyHeading}>
      <p>{t.home.proxyDescription}</p>
      <ActionLink href={href} variant="outline">
        {t.home.proxyButton}
      </ActionLink>
    </Section>
  );
}

function LookupSection({ t }: SectionProps) {
  return (
    <Section heading={t.home.lookupHeading}>
      <p>{t.home.lookupDescription}</p>
      <ActionLink href={lookupPath} variant="outline">
        {t.home.lookupButton}
      </ActionLink>
    </Section>
  );
}

function StepsSection({ t }: SectionProps) {
  return (
    <Section heading={t.home.stepsHeading}>
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
    </Section>
  );
}

function VenuesSection({ content, t }: SectionProps & { content: HomeContent }) {
  if (content.venues.length === 0) return null;
  return (
    <Section heading={t.home.venuesHeading}>
      <ul className="flex flex-col gap-4">
        {content.venues.map((venue, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-lg border-2 border-card-outline p-5">
            <h3 className="text-lead font-bold">{venue.name}</h3>
            {venue.address && (
              <p>
                <span className="font-semibold">{t.home.venueAddress}</span>
                {venue.address}
              </p>
            )}
            {venue.features && (
              <p className="whitespace-pre-line">
                <span className="font-semibold">{t.home.venueFeatures}</span>
                {venue.features}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function HelpSection({ content, t }: SectionProps & { content: HomeContent }) {
  return (
    <Section heading={t.home.helpHeading}>
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

function AboutSection({ content, t }: SectionProps & { content: HomeContent }) {
  const { themeScripture, welcome, faqs } = content;
  if (!themeScripture.text && !welcome && faqs.length === 0) return null;
  return (
    <Section heading={t.home.aboutHeading}>
      {themeScripture.text && (
        <div className="flex flex-col gap-2">
          <h3 className="text-lead font-bold">{t.home.themeScriptureHeading}</h3>
          <blockquote className="border-l-4 border-quote-line pl-4">
            <p className="whitespace-pre-line">{themeScripture.text}</p>
            {themeScripture.reference && <p className="mt-2">— {themeScripture.reference}</p>}
          </blockquote>
        </div>
      )}
      {welcome && (
        <div className="flex flex-col gap-2">
          <h3 className="text-lead font-bold">{t.home.welcomeHeading}</h3>
          <p className="whitespace-pre-line">{welcome}</p>
        </div>
      )}
      {faqs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-lead font-bold">{t.home.faqHeading}</h3>
          <dl className="flex flex-col gap-4">
            {faqs.map((faq, index) => (
              <div key={index}>
                <dt className="font-semibold">{faq.question}</dt>
                <dd className="whitespace-pre-line">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Section>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-heading font-bold">{heading}</h2>
      {children}
    </section>
  );
}

/** 寫完整文字的大按鈕。站內用 Link，站外用一般連結（同一個分頁開，不開彈出視窗）。 */
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
  return href.startsWith("/") ? (
    <Link href={href} className={classes}>
      {children}
    </Link>
  ) : (
    <a href={href} className={classes}>
      {children}
    </a>
  );
}

function statusText(conference: CurrentConference, phase: ShownPhase, t: Messages, locale: Locale): string {
  switch (phase) {
    case "upcoming":
      return conference.registrationOpensAt
        ? t.home.registrationOpensAt(formatDateTime(conference.registrationOpensAt, locale))
        : t.home.registrationOpensSoon;
    case "open":
      return conference.registrationClosesAt
        ? t.home.registrationOpenUntil(formatDateTime(conference.registrationClosesAt, locale))
        : t.home.registrationOpen;
    case "closed":
      return t.home.registrationClosed;
  }
}

// conference_date is a calendar date (YYYY-MM-DD), not an instant; anchor it at noon Taiwan time.
function formatConferenceDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+08:00`));
}

// time is a wall-clock time (HH:MM) in Taiwan on the conference date.
function formatTime(date: string, time: string, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], {
    timeZone: "Asia/Taipei",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(`${date}T${time}:00+08:00`));
}

function formatDateTime(moment: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(languageTags[locale], {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(moment);
}
