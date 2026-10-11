import { LanguageSwitch } from "@/components/language-switch";
import { getCurrentConference, type CurrentConference } from "@/lib/conference";
import { languageTags, type Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const conference = await getCurrentConference(supabase, new Date());

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-12 text-xl leading-relaxed">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <h1 className="text-4xl font-bold">{t.site.title}</h1>
      {!conference || conference.phase === "unannounced" ? (
        <p>{t.home.comingSoon}</p>
      ) : (
        <>
          <p className="text-2xl font-semibold">
            {t.home.conferenceDate(
              conference.year,
              formatConferenceDate(conference.conferenceDate, locale),
            )}
          </p>
          <p className="text-2xl">{statusText(conference, t, locale)}</p>
        </>
      )}
    </main>
  );
}

function statusText(conference: CurrentConference, t: Messages, locale: Locale): string {
  switch (conference.phase) {
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
    case "unannounced":
      return "";
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
