import type { Messages } from "@/lib/i18n/messages";
import { CHOIR_PARTS, SERVICES, type RegistrationInput } from "@/lib/registration";
import type { RegistrationOptions } from "@/lib/registration-options";
import { cn } from "@/lib/utils";

export type Details = Pick<
  RegistrationInput,
  | "name"
  | "stakeId"
  | "wardId"
  | "venueId"
  | "courseIds"
  | "lunchOptionId"
  | "afternoonActivityId"
  | "services"
  | "printedHandbook"
> & {
  phone: string | null;
  email: string | null;
  lineId: string | null;
  choirPart: string | null;
  noPhone?: boolean;
  /** 查詢時由資料庫給的支聯會、支會名稱：報名後它們可能已停用，不在報名表的選項裡。 */
  stakeName?: string;
  wardName?: string;
};

/**
 * 報名資料的清單，確認步驟、完成頁與查詢頁共用。
 * 排得緊湊（標籤與內容同一行、支聯會併進支會），讓完成頁在手機上一個畫面就截得下。
 * 完成頁與查詢頁有報名編號時，編號取代「沒有電話」那一列；沒填的 Email、LINE ID 不列。
 * 場地沒有午餐、午后動態時不列那一列。
 */
export function RegistrationDetails({
  registration,
  registrationNumber,
  options,
  t,
}: {
  registration: Details;
  registrationNumber?: string | null;
  options: RegistrationOptions;
  t: Messages;
}) {
  const stake = options.stakes.find((option) => option.id === registration.stakeId);
  const ward = stake?.wards.find((option) => option.id === registration.wardId);
  const venue = options.venues.find((option) => option.id === registration.venueId);
  const done = registrationNumber !== undefined;
  const email = registration.email?.trim();
  const lineId = registration.lineId?.trim();
  const rows: { label: string; value: string }[] = [
    { label: t.register.nameLabel, value: registration.name.trim() },
    ...(registrationNumber
      ? []
      : [
          {
            label: t.register.phoneLabel,
            value: registration.noPhone || !registration.phone ? t.register.noPhone : registration.phone,
          },
        ]),
    ...(email || !done ? [{ label: t.register.emailShortLabel, value: email || t.register.notProvided }] : []),
    ...(lineId || !done ? [{ label: t.register.lineIdShortLabel, value: lineId || t.register.notProvided }] : []),
    {
      label: t.register.wardLabel,
      value:
        registration.wardName && registration.stakeName
          ? t.register.wardWithStake(registration.wardName, registration.stakeName)
          : stake && ward
            ? t.register.wardWithStake(ward.name, stake.name)
            : "",
    },
    { label: t.register.venueLabel, value: venue?.name ?? "" },
  ];
  // 與報名表的步驟同一個順序：課程之後才是午餐與服務。
  const extraRows: { label: string; value: string }[] = [
    ...(venue && venue.lunchOptions.length > 0
      ? [
          {
            label: t.register.lunchLabel,
            value:
              venue.lunchOptions.find((lunch) => lunch.id === registration.lunchOptionId)?.name ??
              t.register.noLunch,
          },
        ]
      : []),
    ...(venue && venue.afternoonActivities.length > 0
      ? [
          {
            label: t.register.afternoonActivityLabel,
            value:
              venue.afternoonActivities.find(
                (activity) => activity.id === registration.afternoonActivityId,
              )?.name ?? t.register.noAfternoonActivity,
          },
        ]
      : []),
    { label: t.register.servicesShortLabel, value: serviceSummary(registration, t) },
    {
      label: t.register.printedHandbookLabel,
      value: registration.printedHandbook
        ? t.register.printedHandbookShortYes
        : t.register.printedHandbookShortNo,
    },
  ];
  const courses = (venue?.sessions ?? []).map((session) => ({
    session: session.name,
    course:
      session.courses.find((course) => registration.courseIds.includes(course.id))?.name ??
      t.register.noCourse,
  }));
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 leading-snug">
      {/* 報名編號自己一列、放大，標籤較長（英文）時編號換到下一行，不擠窄其他列。 */}
      {registrationNumber && (
        <div className="col-span-2 flex flex-wrap items-baseline gap-x-4">
          <dt className="font-semibold">{t.register.done.registrationNumberLabel}</dt>
          <dd className="text-heading font-bold tracking-widest">{registrationNumber}</dd>
        </div>
      )}
      {rows.map(({ label, value }) => (
        <DetailRow key={label} label={label} value={value} />
      ))}
      {/* 場次名稱通常含時間、比較長，所以課程一個場次佔兩行：場次、所選課程。 */}
      {courses.map(({ session, course }, index) => (
        <div key={index} className={cn("col-span-2", index === 0 && "mt-2")}>
          <dt className="font-semibold">{session}</dt>
          <dd className="wrap-anywhere">{course}</dd>
        </div>
      ))}
      {extraRows.map(({ label, value }, index) => (
        <DetailRow key={label} label={label} value={value} className={cn(index === 0 && "mt-2")} />
      ))}
    </dl>
  );
}

function DetailRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("col-span-2 grid grid-cols-subgrid items-baseline", className)}>
      <dt className="font-semibold">{label}</dt>
      {/* Email 這類沒有空白的長字串也要能斷行，不能撐出框外。 */}
      <dd className="min-w-0 wrap-anywhere">{value}</dd>
    </div>
  );
}

/** 服務意願列成一行，例如「即席唱詩班（女高音）、當天接待」；都沒有時是「無」。 */
function serviceSummary(registration: Pick<Details, "choirPart" | "services">, t: Messages): string {
  const part = CHOIR_PARTS.find((key) => key === registration.choirPart);
  const names = [
    ...(part ? [t.register.choirWithPart(t.register.choirParts[part])] : []),
    ...SERVICES.filter((key) => registration.services.includes(key)).map(
      (key) => t.register.serviceNames[key],
    ),
  ];
  return names.length > 0 ? names.join(t.register.serviceListSeparator) : t.register.noServices;
}

