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
  const [counts, venues, sessions, courses, lunches, activities, stakes, wards] = await Promise.all([
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
    supabase.from("stakes").select("id, name_zh").order("position").order("name_zh"),
    supabase.from("wards").select("id, stake_id, name_zh").order("position").order("name_zh"),
  ]);
  for (const result of [counts, venues, sessions, courses, lunches, activities, stakes, wards]) {
    if (result.error) throw result.error;
  }

  const tally = new Map<string, number>();
  for (const row of counts.data as CountRow[]) tally.set(`${row.kind}:${row.key ?? ""}`, row.count);
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
    stakes: stakes
      .data!.filter((stake) => count("stake", stake.id) > 0)
      .map((stake) => ({
        id: stake.id,
        name: stake.name_zh,
        count: count("stake", stake.id),
        wards: wards
          .data!.filter((ward) => ward.stake_id === stake.id && count("ward", ward.id) > 0)
          .map((ward) => ({ id: ward.id, name: ward.name_zh, count: count("ward", ward.id) })),
      })),
    choir: Object.fromEntries(CHOIR_PARTS.map((part) => [part, count("choir", part)])) as Record<ChoirPart, number>,
    services: Object.fromEntries(SERVICES.map((service) => [service, count("service", service)])) as Record<
      Service,
      number
    >,
    printedHandbook: count("handbook"),
  };
}

type CountRow = { kind: string; key: string | null; count: number };

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
