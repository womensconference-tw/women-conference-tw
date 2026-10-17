import type { SupabaseClient } from "@supabase/supabase-js";
import { CHOIR_PARTS, SERVICES, type ChoirPart, type Service } from "./registration";
import type { Region, StaffScope } from "./staff";

/*
 * 後台統計（#19）：只計有效報名（已取消的不計）。人數由資料庫的 registration_counts 以登入的工作人員身分算，
 * 範圍和報名名單一樣由權限規則決定（ADR 0004）；這裡只把名稱、容量接上去。
 */

export type OptionStatistics = {
  id: string;
  name: string;
  count: number;
  /** 容量；null 表示不限。 */
  capacity: number | null;
};

export type CourseStatistics = { id: string; title: string; count: number; capacity: number | null };

export type VenueStatistics = {
  id: string;
  name: string;
  region: Region;
  count: number;
  sessions: { id: string; name: string; courses: CourseStatistics[] }[];
  lunches: OptionStatistics[];
  /** 選「不需要」午餐的人數。 */
  noLunch: number;
  activities: OptionStatistics[];
  /** 午后動態選「不參加」的人數；沒有午后動態的場地是 0。 */
  noActivity: number;
};

export type StakeStatistics = {
  id: string;
  name: string;
  count: number;
  /** 有人報名的支會。 */
  wards: { id: string; name: string; count: number }[];
};

export type Statistics = {
  total: number;
  /** 年度大會的所有場地，依顯示順序，沒人報名的也列出。 */
  venues: VenueStatistics[];
  /** 有人報名的支聯會（含停用的），依顯示順序。 */
  stakes: StakeStatistics[];
  choir: Record<ChoirPart, number>;
  services: Record<Service, number>;
  printedHandbook: number;
};

/** 某個年度大會、自己範圍內的統計。 */
export async function getStatistics(supabase: SupabaseClient, conferenceId: string): Promise<Statistics> {
  const [counts, venues, sessions, courses, lunches, activities] = await Promise.all([
    supabase.rpc("registration_counts", { p_conference_id: conferenceId }),
    supabase.from("venues").select("id, name_zh, region").eq("conference_id", conferenceId).order("position"),
    supabase.from("sessions").select("id, venue_id, name_zh").eq("conference_id", conferenceId).order("position"),
    supabase
      .from("courses")
      .select("id, session_id, title_zh, capacity")
      .eq("conference_id", conferenceId)
      .order("position"),
    supabase
      .from("lunch_options")
      .select("id, venue_id, name_zh, capacity")
      .eq("conference_id", conferenceId)
      .order("position"),
    supabase
      .from("afternoon_activities")
      .select("id, venue_id, title_zh, capacity")
      .eq("conference_id", conferenceId)
      .order("position"),
  ]);
  for (const result of [counts, venues, sessions, courses, lunches, activities]) {
    if (result.error) throw result.error;
  }

  const rows = counts.data as CountRow[];
  const tally = new Map<string, number>();
  for (const row of rows) tally.set(`${row.kind}:${row.key ?? ""}`, row.count);
  const count = (kind: string, key = "") => tally.get(`${kind}:${key}`) ?? 0;

  const option = (row: { id: string; name: string; capacity: number | null }, kind: string): OptionStatistics => ({
    id: row.id,
    name: row.name,
    count: count(kind, row.id),
    capacity: row.capacity,
  });

  return {
    total: count("total"),
    venues: venues.data!.map((venue) => {
      const venueCount = count("venue", venue.id);
      const venueLunches = lunches
        .data!.filter((lunch) => lunch.venue_id === venue.id)
        .map((lunch) => option({ id: lunch.id, name: lunch.name_zh, capacity: lunch.capacity }, "lunch"));
      const venueActivities = activities
        .data!.filter((activity) => activity.venue_id === venue.id)
        .map((activity) =>
          option({ id: activity.id, name: activity.title_zh, capacity: activity.capacity }, "activity"),
        );
      return {
        id: venue.id,
        name: venue.name_zh,
        region: venue.region,
        count: venueCount,
        sessions: sessions
          .data!.filter((session) => session.venue_id === venue.id)
          .map((session) => ({
            id: session.id,
            name: session.name_zh,
            courses: courses
              .data!.filter((course) => course.session_id === session.id)
              .map((course) => ({
                id: course.id,
                title: course.title_zh,
                count: count("course", course.id),
                capacity: course.capacity,
              })),
          })),
        lunches: venueLunches,
        noLunch: venueCount - sum(venueLunches),
        activities: venueActivities,
        noActivity: venueActivities.length > 0 ? venueCount - sum(venueActivities) : 0,
      };
    }),
    stakes: inOrder(rows.filter((row) => row.kind === "stake")).map((stake) => ({
      id: stake.key!,
      name: stake.name!,
      count: stake.count,
      wards: inOrder(rows.filter((row) => row.kind === "ward" && row.parent === stake.key)).map((ward) => ({
        id: ward.key!,
        name: ward.name!,
        count: ward.count,
      })),
    })),
    choir: Object.fromEntries(CHOIR_PARTS.map((part) => [part, count("choir", part)])) as Record<ChoirPart, number>,
    services: Object.fromEntries(SERVICES.map((service) => [service, count("service", service)])) as Record<
      Service,
      number
    >,
    printedHandbook: count("handbook"),
  };
}

/** registration_counts 的一項。支聯會、支會另有名稱、顯示順序，支會的 parent 是所屬支聯會。 */
type CountRow = { kind: string; key?: string; count: number; name?: string; parent?: string; position?: number };

/** 依顯示順序、再依名稱排，和支聯會、支會名單一樣。 */
function inOrder(rows: CountRow[]): CountRow[] {
  return rows.toSorted((a, b) => a.position! - b.position! || a.name!.localeCompare(b.name!));
}

/**
 * 課程、午餐、午后動態的「已報／容量」；不限人數的只顯示已報人數。
 * 只計得到部分報名（`partial`，見 venuesInView）時不列容量，免得額滿的課看起來還有很多名額。
 */
export function formatUsage(option: Pick<OptionStatistics, "count" | "capacity">, partial: boolean): string {
  if (partial) return String(option.count);
  return option.capacity === null ? `${option.count}（不限）` : `${option.count}／${option.capacity}`;
}

/**
 * 後台超收前的確認提示（#17）：額滿的課程、午餐、午后動態各一句，例如「課程「拼布」：已報 30／30」。
 * 依場地、場次內的順序；不認得的 id 略過。成對課程的另一堂也會列出（一堂額滿，兩堂一起確認）。
 */
export function describeFullOptions(statistics: Statistics, ids: string[]): string[] {
  const usage = (option: { count: number; capacity: number | null }) => `已報 ${formatUsage(option, false)}`;
  return statistics.venues.flatMap((venue) => [
    ...venue.sessions
      .flatMap((session) => session.courses)
      .filter((course) => ids.includes(course.id))
      .map((course) => `課程「${course.title}」：${usage(course)}`),
    ...venue.lunches.filter((lunch) => ids.includes(lunch.id)).map((lunch) => `午餐「${lunch.name}」：${usage(lunch)}`),
    ...venue.activities
      .filter((activity) => ids.includes(activity.id))
      .map((activity) => `午后動態「${activity.name}」：${usage(activity)}`),
  ]);
}

function sum(options: { count: number }[]): number {
  return options.reduce((total, item) => total + item.count, 0);
}

/**
 * 統計頁要列出的場地。總管理員與全區的報報組看全部；課務組看該區的場地；
 * 報報組看該區的場地，加上有該區支聯會姐妹報名的別區場地。
 * `partial` 表示這個場地只計得到本區支聯會的姐妹，課程、午餐的人數不是全部。
 * 只決定怎麼顯示；數得到哪些報名已由資料庫決定。
 */
export function venuesInView<T extends { region: Region; count: number }>(
  venues: T[],
  staff: StaffScope,
): (T & { partial: boolean })[] {
  return venues
    .filter(
      (venue) =>
        staff.region === null ||
        venue.region === staff.region ||
        (staff.role === "registration_team" && venue.count > 0),
    )
    .map((venue) => ({ ...venue, partial: staff.region !== null && venue.region !== staff.region }));
}
