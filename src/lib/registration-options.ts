import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "./i18n/locale";
import { localized } from "./i18n/localized";
import type { PairedCourse } from "./registration";

/** 課程、午餐、午后動態這類可能限量的選項。 */
export type LimitedOption = {
  id: string;
  name: string;
  description: string;
  /** 讀取當下已額滿。送出時資料庫會再確認一次。 */
  isFull: boolean;
};

export type CourseOption = LimitedOption & {
  /** 成對課程的另一堂；選了這堂就要一起選。不是成對課程時是 null。 */
  pairedWith: PairedCourse | null;
};

export type SessionOption = { id: string; name: string; courses: CourseOption[] };

export type VenueOption = {
  id: string;
  name: string;
  sessions: SessionOption[];
  /** 這個場地的午餐；沒有的話不問午餐。 */
  lunchOptions: LimitedOption[];
  /** 這個場地的午后動態；只有設定了它的場地才有。 */
  afternoonActivities: LimitedOption[];
};

export type WardOption = {
  id: string;
  /** 依語言挑好的名稱。 */
  name: string;
  /** 搜尋用：中英文名稱都能找到。 */
  nameZh: string;
  nameEn: string;
};

export type StakeOption = { id: string; name: string; wards: WardOption[] };

/** 報名表可選的場地（含場次與課程）、支聯會與支會，已依語言挑好名稱。 */
export type RegistrationOptions = { venues: VenueOption[]; stakes: StakeOption[] };

/**
 * 讀取報名表的選項：目前年度的場地與各場地的場次、課程、午餐、午后動態（標出已額滿），
 * 以及啟用中的支聯會、支會（停用的由資料庫權限規則擋掉）。
 * 沒有任何啟用中支會的支聯會不列出，免得選了之後沒有支會可選。
 * 都依排序列出，排序相同時依 id，讓順序每次都一樣。
 */
export async function getRegistrationOptions(
  supabase: SupabaseClient,
  locale: Locale,
): Promise<RegistrationOptions> {
  const [venues, stakes, pairs, fullCourses, fullLunches, fullActivities] = await Promise.all([
    supabase
      .from("venues")
      .select(
        "id, name_zh, name_en, conferences!inner(is_current), sessions(id, name_zh, name_en, courses(id, title_zh, title_en, description_zh, description_en)), lunch_options(id, name_zh, name_en, description_zh, description_en), afternoon_activities(id, title_zh, title_en, description_zh, description_en)",
      )
      .eq("conferences.is_current", true)
      .order("position")
      .order("id")
      .order("position", { referencedTable: "sessions" })
      .order("id", { referencedTable: "sessions" })
      .order("position", { referencedTable: "sessions.courses" })
      .order("id", { referencedTable: "sessions.courses" })
      .order("position", { referencedTable: "lunch_options" })
      .order("id", { referencedTable: "lunch_options" })
      .order("position", { referencedTable: "afternoon_activities" })
      .order("id", { referencedTable: "afternoon_activities" }),
    supabase
      .from("stakes")
      .select("id, name_zh, name_en, wards(id, name_zh, name_en)")
      .order("position")
      .order("id")
      .order("position", { referencedTable: "wards" })
      .order("id", { referencedTable: "wards" }),
    // 成對課程其中一堂額滿時，full_courses 兩堂都會列出。
    supabase.from("course_pairs").select("first_course_id, second_course_id"),
    supabase.rpc("full_courses"),
    supabase.rpc("full_lunch_options"),
    supabase.rpc("full_afternoon_activities"),
  ]);
  if (venues.error) throw venues.error;
  if (stakes.error) throw stakes.error;
  for (const result of [pairs, fullCourses, fullLunches, fullActivities]) {
    if (result.error) throw result.error;
  }
  const full = new Set<string>([...fullCourses.data, ...fullLunches.data, ...fullActivities.data]);
  const option = <F extends "name" | "title">(
    row: { id: string } & Record<`${F}_zh` | `${F}_en` | "description_zh" | "description_en", string>,
    nameField: F,
  ): LimitedOption => ({
    id: row.id,
    name: localized<F>(row, nameField, locale),
    description: localized(row, "description", locale),
    isFull: full.has(row.id),
  });

  // 每門成對課程對應的另一堂（兩個方向都記）。
  const partners = new Map<string, string>(
    pairs.data!.flatMap((pair) => [
      [pair.first_course_id, pair.second_course_id],
      [pair.second_course_id, pair.first_course_id],
    ]),
  );

  return {
    venues: venues.data.map((venue) => ({
      id: venue.id,
      name: localized(venue, "name", locale),
      // 還沒開課的場次沒有東西可選，報名時也不檢查，所以不列出。
      sessions: venue.sessions
        .filter((session) => session.courses.length > 0)
        .map((session) => ({
        id: session.id,
        name: localized(session, "name", locale),
        courses: session.courses.map((course) => ({
          ...option(course, "title"),
          pairedWith: pairedCourse(venue.sessions, partners.get(course.id)),
        })),
      })),
      lunchOptions: venue.lunch_options.map((lunch) => option(lunch, "name")),
      afternoonActivities: venue.afternoon_activities.map((activity) => option(activity, "title")),
    })),
    stakes: stakes.data
      .filter((stake) => stake.wards.length > 0)
      .map((stake) => ({
        id: stake.id,
        name: localized(stake, "name", locale),
        wards: stake.wards.map((ward) => ({
          id: ward.id,
          name: localized(ward, "name", locale),
          nameZh: ward.name_zh,
          nameEn: ward.name_en,
        })),
      })),
  };
}

/** 成對課程的另一堂在這個場地的哪個場次；找不到（不該發生）時當成不是成對課程。 */
function pairedCourse(
  sessions: { id: string; courses: { id: string }[] }[],
  courseId: string | undefined,
): PairedCourse | null {
  const session = sessions.find((candidate) => candidate.courses.some((course) => course.id === courseId));
  return session && courseId ? { sessionId: session.id, courseId } : null;
}

export type WardMatch = { stakeId: string; stakeName: string; wardId: string; wardName: string };

/** 用部分支會名稱（中文或英文，不分大小寫）找支會，連同所屬支聯會一起列出。 */
export function searchWards(stakes: StakeOption[], query: string): WardMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return stakes.flatMap((stake) =>
    stake.wards
      .filter((ward) =>
        [ward.nameZh, ward.nameEn].some((name) => name.toLowerCase().includes(needle)),
      )
      .map((ward) => ({
        stakeId: stake.id,
        stakeName: stake.name,
        wardId: ward.id,
        wardName: ward.name,
      })),
  );
}
