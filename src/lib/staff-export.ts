import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { REGISTRANT_ROLE_LABELS, type ChoirPart, type RegistrantRole, type Service } from "./registration";
import { CLEARED_NAME, REGISTRATION_STATUS_LABELS, type RegistrationStatus } from "./registration-list";
import { REGION_LABELS, getStaffMember, type Region, type StaffRole } from "./staff";
import { CHOIR_LABELS, SERVICE_COLUMNS, chineseNumber } from "./year-export";

/*
 * 後台匯出 CSV（#20）。用登入的工作人員身分讀資料，讀得到哪些報名、哪些教室由資料庫的權限規則決定（ADR 0004），
 * 所以課務組、報報組匯出的一定只有自己範圍內的。哪一種匯出誰能用，在這裡依角色檢查：
 * - 名牌：總管理員與課務組。名牌背面要印教室，報報組看不到教室，不能匯出。
 * - 範圍內名單：課務組、報報組。總管理員的範圍就是全部，用完整名單。
 * - 完整名單、支聯會簡表：只有總管理員（全區報報組讀得到全部報名，也不能匯出）。
 * 和大會結束後的年度 Excel（ADR 0008）是不同的東西：這裡不記匯出紀錄，報名期間隨時可以匯出。
 */

export type StaffExportKind = "badges" | "roster" | "full_roster" | "stake_summary";

export type StaffExportError = "not_allowed" | "not_found";

const ALLOWED: Record<StaffExportKind, StaffRole[]> = {
  badges: ["admin", "course_team"],
  roster: ["course_team", "registration_team"],
  full_roster: ["admin"],
  stake_summary: ["admin"],
};

/** 這個角色能用哪幾種匯出（畫面上只顯示這幾個按鈕）。 */
export function allowedExports(role: StaffRole): StaffExportKind[] {
  return (Object.keys(ALLOWED) as StaffExportKind[]).filter((kind) => ALLOWED[kind].includes(role));
}

const FILE_NAMES: Record<StaffExportKind, string> = {
  badges: "名牌",
  roster: "報名名單",
  full_roster: "完整名單",
  stake_summary: "支聯會簡表",
};

/** 要當成文字的欄（Excel 不能去掉電話開頭的 0），給 writeCsv。 */
export const TEXT_COLUMNS = ["電話"];

/** 下載的檔名，例如「2026 年名牌.csv」。 */
export function staffExportFileName(kind: StaffExportKind, year: number): string {
  return `${year} 年${FILE_NAMES[kind]}.csv`;
}

export function isStaffExportKind(value: unknown): value is StaffExportKind {
  return typeof value === "string" && Object.hasOwn(ALLOWED, value);
}

/**
 * 某個年度的匯出內容（表頭加資料列）。不是工作人員或角色不能用這種匯出時是 not_allowed。
 * 測試用：pageSize 是分批讀取時一批幾筆；afterPage 在報名讀完一批（還有下一批）時呼叫，
 * 用來模擬讀到一半資料有變動。
 */
export async function exportStaffCsv(
  supabase: SupabaseClient,
  kind: StaffExportKind,
  year: number,
  { pageSize = PAGE_SIZE, afterPage }: ExportOptions = {},
): Promise<{ ok: true; rows: string[][] } | { ok: false; error: StaffExportError }> {
  const me = await getStaffMember(supabase);
  if (!me || !ALLOWED[kind].includes(me.role)) return { ok: false, error: "not_allowed" };

  const { data: conference, error } = await supabase.from("conferences").select("id").eq("year", year).maybeSingle();
  if (error) throw error;
  if (!conference) return { ok: false, error: "not_found" };

  const data = await loadExportData(supabase, conference.id, { pageSize, afterPage });
  switch (kind) {
    case "badges":
      return { ok: true, rows: badgeRows(data) };
    case "roster":
      return { ok: true, rows: rosterRows(data, false) };
    case "full_roster":
      return { ok: true, rows: rosterRows(data, true) };
    case "stake_summary":
      return { ok: true, rows: stakeSummaryRows(data) };
  }
}

type Venue = { id: string; name: string; sessions: { id: string; name: string }[] };

type Course = { title: string; classroom: string };

type Registration = {
  name: string;
  phone: string;
  registrationNumber: string;
  email: string;
  lineId: string;
  locale: string;
  role: RegistrantRole;
  status: RegistrationStatus;
  choirPart: ChoirPart | null;
  services: Service[];
  printedHandbook: boolean;
  createdAt: string;
  crossRegion: boolean;
  suspectedDuplicate: boolean;
  venueId: string;
  lunch: string | null;
  stake: { id: string; name: string; region: Region; position: number };
  ward: { id: string; name: string; position: number };
  /** 場次編號 → 課程編號。 */
  courses: Map<string, string>;
};

type ExportData = {
  /** 依顯示順序的場地，各自依順序列出場次。 */
  venues: Venue[];
  /** 課程編號 → 名稱與教室（讀不到教室時是空字串）。 */
  courses: Map<string, Course>;
  /** 自己範圍內的報名（含已取消），依場地、支聯會、支會、報名先後排序。 */
  registrations: Registration[];
};

type ExportOptions = { pageSize?: number; afterPage?: (ids: string[]) => Promise<void> };

// PostgREST 一次最多回傳的筆數（supabase/config.toml 的 max_rows）；報名、課程可能比這個多，分批讀。
const PAGE_SIZE = 1000;

/**
 * 依編號分批讀完：每一批從上一批最後一筆的編號之後接著讀。不用「跳過前 N 筆」，
 * 讀到一半有人被改到範圍外時，後面沒變動的報名才不會被跳過。
 */
async function readAll<T extends { id: string }>(
  page: (afterId: string | null, size: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  size: number,
  afterPage?: (ids: string[]) => Promise<void>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let afterId: string | null = null; ; ) {
    const { data, error } = await page(afterId, size);
    if (error) throw error;
    rows.push(...data!);
    if (data!.length < size) return rows;
    await afterPage?.(data!.map((row) => row.id));
    afterId = data![data!.length - 1].id;
  }
}

/** 資料庫的時間到微秒（例如 2026-10-16T01:30:00.123456+00:00）；Date.parse 只到毫秒，同一毫秒內的先後會不見。 */
function microseconds(iso: string): number {
  const fraction = /\.(\d+)/.exec(iso)?.[1] ?? "";
  return Date.parse(iso.replace(/\.\d+/, "")) * 1000 + Number(fraction.padEnd(6, "0").slice(0, 6));
}

async function loadExportData(
  supabase: SupabaseClient,
  conferenceId: string,
  { pageSize = PAGE_SIZE, afterPage }: ExportOptions,
): Promise<ExportData> {
  const [venues, sessions, lunches] = await Promise.all([
    // 顯示順序可能相同（新增的預設是 0），再依名稱、編號，每次匯出的欄位順序才一樣。
    supabase
      .from("venues")
      .select("id, name_zh")
      .eq("conference_id", conferenceId)
      .order("position")
      .order("name_zh")
      .order("id"),
    supabase
      .from("sessions")
      .select("id, venue_id, name_zh")
      .eq("conference_id", conferenceId)
      .order("position")
      .order("id"),
    supabase.from("lunch_options").select("id, name_zh").eq("conference_id", conferenceId),
  ]);
  for (const result of [venues, sessions, lunches]) {
    if (result.error) throw result.error;
  }

  const [courses, registrations] = await Promise.all([
    // 教室在另一張表，讀不到（報報組、別區的課務組）時是 null。
    readAll<CourseRow>((afterId, size) => {
      let query = supabase
        .from("courses")
        .select("id, title_zh, course_classrooms(classroom)")
        .eq("conference_id", conferenceId);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id").limit(size).overrideTypes<CourseRow[], { merge: false }>();
    }, pageSize),
    readAll<RegistrationRow>((afterId, size) => {
      let query = supabase
        .from("registrations")
        .select(
          "id, name, phone, registration_number, email, line_id, locale, role, status, choir_part, services, printed_handbook, created_at, is_cross_region, is_suspected_duplicate, venue_id, lunch_option_id, stakes(id, name_zh, position, region), wards(id, name_zh, position), registration_courses(session_id, course_id)",
        )
        .eq("conference_id", conferenceId);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id").limit(size).overrideTypes<RegistrationRow[], { merge: false }>();
    }, pageSize, afterPage),
  ]);
  // 依報名先後；下面依場地、支聯會、支會排序時，sort 不改變相等的順序。
  const rows = registrations.toSorted(
    (a, b) => microseconds(a.created_at) - microseconds(b.created_at) || a.id.localeCompare(b.id),
  );

  const venueOrder = new Map(venues.data!.map((venue, index) => [venue.id, index]));
  const lunchNames = new Map(lunches.data!.map((lunch) => [lunch.id, lunch.name_zh as string]));
  // 依場地、支聯會、支會的顯示順序，同一支會的依報名先後。
  // 順序可能相同（新增的預設是 0），再依名稱、編號，同一支聯會、支會的才會排在一起。
  const sorted = rows.toSorted(
    (a, b) =>
      (venueOrder.get(a.venue_id) ?? 0) - (venueOrder.get(b.venue_id) ?? 0) ||
      compareGroup(a.stakes, b.stakes) ||
      compareGroup(a.wards, b.wards),
  );

  return {
    venues: venues.data!.map((venue) => ({
      id: venue.id,
      name: venue.name_zh,
      sessions: sessions
        .data!.filter((session) => session.venue_id === venue.id)
        .map((session) => ({ id: session.id, name: session.name_zh })),
    })),
    courses: new Map(
      courses.map((course) => [
        course.id,
        { title: course.title_zh, classroom: course.course_classrooms?.classroom ?? "" },
      ]),
    ),
    registrations: sorted.map((row) => ({
      name: row.name ?? CLEARED_NAME,
      phone: row.phone ?? "",
      registrationNumber: row.registration_number ?? "",
      email: row.email ?? "",
      lineId: row.line_id ?? "",
      locale: row.locale,
      role: row.role,
      status: row.status,
      choirPart: row.choir_part,
      services: row.services,
      printedHandbook: row.printed_handbook,
      createdAt: row.created_at,
      crossRegion: row.is_cross_region,
      suspectedDuplicate: row.is_suspected_duplicate,
      venueId: row.venue_id,
      lunch: row.lunch_option_id ? (lunchNames.get(row.lunch_option_id) ?? "") : null,
      stake: {
        id: row.stakes?.id ?? "",
        name: row.stakes?.name_zh ?? "",
        region: row.stakes?.region ?? "north",
        position: row.stakes?.position ?? 0,
      },
      ward: { id: row.wards?.id ?? "", name: row.wards?.name_zh ?? "", position: row.wards?.position ?? 0 },
      courses: new Map(row.registration_courses.map((choice) => [choice.session_id, choice.course_id])),
    })),
  };
}

type RegistrationRow = {
  id: string;
  name: string | null;
  phone: string | null;
  registration_number: string | null;
  email: string | null;
  line_id: string | null;
  locale: string;
  role: RegistrantRole;
  status: RegistrationStatus;
  choir_part: ChoirPart | null;
  services: Service[];
  printed_handbook: boolean;
  created_at: string;
  is_cross_region: boolean;
  is_suspected_duplicate: boolean;
  venue_id: string;
  lunch_option_id: string | null;
  stakes: { id: string; name_zh: string; position: number; region: Region } | null;
  wards: { id: string; name_zh: string; position: number } | null;
  registration_courses: { session_id: string; course_id: string }[];
};

type Group = { id: string; name_zh: string; position: number } | null;

function compareGroup(a: Group, b: Group): number {
  return (
    (a?.position ?? 0) - (b?.position ?? 0) ||
    (a?.name_zh ?? "").localeCompare(b?.name_zh ?? "", "zh-TW") ||
    (a?.id ?? "").localeCompare(b?.id ?? "")
  );
}

type CourseRow = { id: string; title_zh: string; course_classrooms: { classroom: string } | null };

/** 第 1 至 N 場次的位置；N 是場次最多的場地的場次數（和年度 Excel 一樣）。 */
function sessionPositions(venues: Venue[]): number[] {
  return Array.from({ length: Math.max(0, ...venues.map((venue) => venue.sessions.length)) }, (_, index) => index);
}

const sessionLabel = (index: number) => `第${chineseNumber(index + 1)}場次`;

/**
 * 名牌給廠商印：正面姓名、身分類別；背面場地、每個場次的名稱、課程與教室、午餐、手冊。只列有效報名。
 * 有這個場次但沒選課填「不選課」；場地沒有這個場次的三欄空白（名牌上不印）；沒填教室的空白。
 */
function badgeRows(data: ExportData): string[][] {
  const positions = sessionPositions(data.venues);
  const venues = new Map(data.venues.map((venue) => [venue.id, venue]));
  return [
    [
      "姓名",
      "身分類別",
      "參加教堂",
      ...positions.flatMap((index) => [sessionLabel(index), `${sessionLabel(index)}課程`, `${sessionLabel(index)}教室`]),
      "午餐",
      "紙本手冊",
    ],
    ...data.registrations
      .filter((registration) => registration.status === "registered")
      .map((registration) => {
        const venue = venues.get(registration.venueId);
        return [
          registration.name,
          REGISTRANT_ROLE_LABELS[registration.role] ?? registration.role,
          venue?.name ?? "",
          ...positions.flatMap((index) => {
            const session = venue?.sessions[index];
            if (!session) return ["", "", ""];
            const course = data.courses.get(registration.courses.get(session.id) ?? "");
            return [session.name, course?.title ?? "不選課", course?.classroom ?? ""];
          }),
          registration.lunch ?? "不需要",
          registration.printedHandbook ? "需要" : "不需要",
        ];
      }),
  ];
}

const TIME_FORMAT = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 名單：自己範圍內的報名，已取消的也列出，「狀態」欄標示。各場次欄位填課程名稱，有這個場次但沒選課填「不選課」，
 * 場地沒有這個場次填「不適用」。完整名單（只限總管理員）另外加上 Email、LINE ID、報名語言與服務意願。
 */
function rosterRows(data: ExportData, full: boolean): string[][] {
  const positions = sessionPositions(data.venues);
  const venues = new Map(data.venues.map((venue) => [venue.id, venue]));
  const yesNo = (value: boolean) => (value ? "是" : "否");
  return [
    [
      "姓名",
      "電話",
      "報名編號",
      "參加教堂",
      "支聯會",
      "支會",
      "身分類別",
      "狀態",
      "跨區",
      "疑似重複",
      ...positions.map((index) => `${sessionLabel(index)}課程`),
      "午餐",
      "紙本手冊",
      "報名時間",
      ...(full
        ? ["Email", "LINE ID", "報名語言", "即席唱詩班", ...SERVICE_COLUMNS.map(([, label]) => label)]
        : []),
    ],
    ...data.registrations.map((registration) => {
      const venue = venues.get(registration.venueId);
      return [
        registration.name,
        registration.phone,
        registration.registrationNumber,
        venue?.name ?? "",
        registration.stake.name,
        registration.ward.name,
        REGISTRANT_ROLE_LABELS[registration.role] ?? registration.role,
        REGISTRATION_STATUS_LABELS[registration.status] ?? registration.status,
        yesNo(registration.crossRegion),
        yesNo(registration.suspectedDuplicate),
        ...positions.map((index) => {
          const session = venue?.sessions[index];
          if (!session) return "不適用";
          return data.courses.get(registration.courses.get(session.id) ?? "")?.title ?? "不選課";
        }),
        registration.lunch ?? "不需要",
        registration.printedHandbook ? "需要" : "不需要",
        TIME_FORMAT.format(new Date(registration.createdAt)),
        ...(full
          ? [
              registration.email,
              registration.lineId,
              registration.locale,
              registration.choirPart ? CHOIR_LABELS[registration.choirPart] : "不參加",
              ...SERVICE_COLUMNS.map(([service]) => yesNo(registration.services.includes(service))),
            ]
          : []),
      ];
    }),
  ];
}

/**
 * 支聯會簡表：每個有人報名的支會一列，各場地的有效報名人數與合計；每個支聯會後面一列小計，最後一列總計。
 * 依支聯會、支會的顯示順序。
 */
function stakeSummaryRows(data: ExportData): string[][] {
  const valid = data.registrations.filter((registration) => registration.status === "registered");
  const countRow = (registrations: Registration[]) => [
    ...data.venues.map((venue) =>
      String(registrations.filter((registration) => registration.venueId === venue.id).length),
    ),
    String(registrations.length),
  ];

  // 依支聯會、支會的顯示順序排好，再依序分組（Map 照放進去的順序）。
  const group = (item: { id: string; name: string; position: number }) => ({ ...item, name_zh: item.name });
  const sorted = valid.toSorted(
    (a, b) => compareGroup(group(a.stake), group(b.stake)) || compareGroup(group(a.ward), group(b.ward)),
  );
  const stakes = new Map<string, { stake: Registration["stake"]; wards: Map<string, Registration[]> }>();
  for (const registration of sorted) {
    const stake = stakes.get(registration.stake.id) ?? { stake: registration.stake, wards: new Map() };
    stake.wards.set(registration.ward.id, [...(stake.wards.get(registration.ward.id) ?? []), registration]);
    stakes.set(registration.stake.id, stake);
  }

  return [
    ["區", "支聯會", "支會", ...data.venues.map((venue) => venue.name), "合計"],
    ...[...stakes.values()].flatMap(({ stake, wards }) => {
      const region = REGION_LABELS[stake.region] ?? "";
      return [
        ...[...wards.values()].map((registrations) => [
          region,
          stake.name,
          registrations[0].ward.name,
          ...countRow(registrations),
        ]),
        [region, stake.name, "小計", ...countRow([...wards.values()].flat())],
      ];
    }),
    ["", "總計", "", ...countRow(valid)],
  ];
}
