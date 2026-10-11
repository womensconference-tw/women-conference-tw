import { getCurrentConference, type CurrentConference } from "@/lib/conference";
import { createClient } from "@/lib/supabase/server";

const dateFormat = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const dateTimeFormat = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function Home() {
  const supabase = await createClient();
  const conference = await getCurrentConference(supabase, new Date());

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-12 text-xl leading-relaxed">
      <h1 className="text-4xl font-bold">台灣姐妹大會</h1>
      {!conference || conference.phase === "unannounced" ? (
        <p>大會資訊即將公布，請稍後再來看看。</p>
      ) : (
        <>
          <p className="text-2xl font-semibold">
            {conference.year} 年大會：{formatConferenceDate(conference.conferenceDate)}
          </p>
          <p className="text-2xl">{statusText(conference)}</p>
        </>
      )}
    </main>
  );
}

function statusText(conference: CurrentConference): string {
  switch (conference.phase) {
    case "upcoming":
      return conference.registrationOpensAt
        ? `報名將於 ${dateTimeFormat.format(conference.registrationOpensAt)} 開放`
        : "報名開放時間即將公布";
    case "open":
      return conference.registrationClosesAt
        ? `報名進行中，${dateTimeFormat.format(conference.registrationClosesAt)} 截止`
        : "報名進行中";
    case "closed":
      return "報名已截止";
    case "unannounced":
      return "";
  }
}

// conference_date is a calendar date (YYYY-MM-DD), not an instant; anchor it at noon Taiwan time.
function formatConferenceDate(date: string): string {
  return dateFormat.format(new Date(`${date}T12:00:00+08:00`));
}
