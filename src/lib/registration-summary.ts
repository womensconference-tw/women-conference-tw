import type { Messages } from "./i18n/messages";
import { CHOIR_PARTS, SERVICES, type RegistrationInput } from "./registration";

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

export type SummaryRow = { label: string; value: string };

type Named = { id: string; name: string };

/** 列出報名資料需要的名稱。報名表的選項（RegistrationOptions）就有這些；確認信由資料庫給。 */
export type SummaryOptions = {
  venues: (Named & {
    sessions: { name: string; courses: Named[] }[];
    lunchOptions: Named[];
    afternoonActivities: Named[];
  })[];
  stakes: (Named & { wards: Named[] })[];
};

/**
 * 報名資料清單的內容，依報名表的步驟排列：聯絡資料與場地、每個場次的課程、午餐與服務。
 * 確認步驟、完成頁、查詢頁與確認信共用，列出的內容才會一致。
 * done（送出以後）時有報名編號就不列電話（編號另外顯示），沒填的 Email、LINE ID 不列。
 * 場地沒有午餐、午后動態時不列那一列。
 */
export function summarizeRegistration(
  registration: Details,
  options: SummaryOptions,
  t: Messages,
  { done, registrationNumber }: { done: boolean; registrationNumber?: string | null },
): { rows: SummaryRow[]; courses: { session: string; course: string }[]; extraRows: SummaryRow[] } {
  const stake = options.stakes.find((option) => option.id === registration.stakeId);
  const ward = stake?.wards.find((option) => option.id === registration.wardId);
  const venue = options.venues.find((option) => option.id === registration.venueId);
  const email = registration.email?.trim();
  const lineId = registration.lineId?.trim();
  const rows: SummaryRow[] = [
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
  const extraRows: SummaryRow[] = [
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
  return { rows, courses, extraRows };
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
