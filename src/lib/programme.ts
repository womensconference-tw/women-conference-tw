import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { trimBlank, UUID_PATTERN } from "./registration";
import { REGIONS, type Region } from "./staff";

/*
 * 後台編輯目前年度的場地、場次、課程、成對課程與午餐（#22）。午后動態就是某個場地下午的一個場次（#65）。
 * 只有總管理員能寫入，由資料庫的權限規則強制（ADR 0004）；這裡先確認一次，好在畫面上說明。
 * 報名開放後不能新增、刪除、換時段，有人選過的選項不能刪除，都由資料庫擋下，這裡把錯誤轉成代碼。
 */

/** 可以新增、修改、刪除的項目：場地、場次、課程、午餐。 */
export const ITEM_KINDS = ["venue", "session", "course", "lunch"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** 每種項目存在哪張表、名稱與上層欄位叫什麼。上層：場次屬於場地、課程屬於場次、午餐屬於場地。 */
const ITEMS: Record<
  ItemKind,
  { table: string; name: "name" | "title"; parent: "venue_id" | "session_id" | null; capacity: boolean }
> = {
  venue: { table: "venues", name: "name", parent: null, capacity: false },
  session: { table: "sessions", name: "name", parent: "venue_id", capacity: false },
  course: { table: "courses", name: "title", parent: "session_id", capacity: true },
  lunch: { table: "lunch_options", name: "name", parent: "venue_id", capacity: true },
};

/** 新增或修改一個項目時填的欄位，都是表單上的原始文字。用不到的欄位不填。 */
export type ItemInput = {
  kind: ItemKind;
  /** 有就是修改，沒有就是新增。 */
  id?: string | null;
  conferenceId: string;
  /** 上層的場地或場次。修改課程時換場次就是換時段；其他項目修改時不能換上層，不用填。 */
  parentId?: string | null;
  /** 排序，小的在前；空白當成 0。 */
  position?: string;
  nameZh: string;
  nameEn?: string;
  /** 課程、午餐的說明。 */
  descriptionZh?: string;
  descriptionEn?: string;
  /** 場地所在的區。 */
  region?: string;
  /** 場地的地址與特色。 */
  addressZh?: string;
  addressEn?: string;
  featuresZh?: string;
  featuresEn?: string;
  /** 課程、午餐的名額；空白表示不限。 */
  capacity?: string;
  /** 課程的教室；空白表示還沒排。 */
  classroom?: string;
  /** 課程的講師；空白表示不顯示。 */
  speakerZh?: string;
  speakerEn?: string;
  /** 課程的分類：同一年度的一項大會特色；空白表示沒有分類。 */
  highlightId?: string | null;
};

export type ProgrammeError =
  | "not_admin"
  | "name_required"
  | "region_required"
  | "capacity_invalid"
  | "position_invalid"
  | "classroom_invalid"
  | "highlight_invalid"
  | "in_use"
  | "programme_locked"
  | "course_pair_invalid"
  | "course_pair_stopped_apart"
  | "not_found"
  | "unavailable";

export type ProgrammeResult = { ok: true } | { ok: false; error: ProgrammeError };

/** 教室最多幾個字，和資料庫 course_classrooms_classroom_valid 一致。 */
const CLASSROOM_MAX_LENGTH = 50;

/** 名額：空白是不限（null），正整數是上限，其他的不接受（undefined）。 */
export function parseCapacity(raw: string): number | null | undefined {
  const value = trimBlank(raw);
  if (value === "") return null;
  return /^[1-9][0-9]{0,5}$/.test(value) ? Number(value) : undefined;
}

function parsePosition(raw: string | undefined): number | undefined {
  const value = trimBlank(raw ?? "");
  if (value === "") return 0;
  return /^-?[0-9]{1,6}$/.test(value) ? Number(value) : undefined;
}

/** 新增或修改一個項目。課程的教室一起存。 */
export async function saveItem(
  supabase: SupabaseClient,
  input: ItemInput,
): Promise<{ ok: true; id: string } | { ok: false; error: ProgrammeError }> {
  const item = ITEMS[input.kind];
  const text = (value: string | undefined) => trimBlank(value ?? "");

  const nameZh = text(input.nameZh);
  if (!nameZh) return { ok: false, error: "name_required" };
  const position = parsePosition(input.position);
  if (position === undefined) return { ok: false, error: "position_invalid" };
  const capacity = parseCapacity(input.capacity ?? "");
  if (item.capacity && capacity === undefined) return { ok: false, error: "capacity_invalid" };
  const region = REGIONS.find((candidate) => candidate === input.region);
  if (input.kind === "venue" && !region) return { ok: false, error: "region_required" };
  const classroom = text(input.classroom);
  if (classroom.length > CLASSROOM_MAX_LENGTH) return { ok: false, error: "classroom_invalid" };

  if (!validIds(input.id, input.conferenceId, input.parentId)) return { ok: false, error: "not_found" };
  if (!validIds(input.highlightId)) return { ok: false, error: "highlight_invalid" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  // 課程連同教室、講師與分類在同一個交易裡存（save_course），教室存不了時課程也不存。
  if (input.kind === "course") {
    const { data, error } = await supabase.rpc("save_course", {
      p_id: input.id || null,
      p_conference_id: input.conferenceId,
      p_session_id: input.parentId || null,
      p_position: position,
      p_title_zh: nameZh,
      p_title_en: text(input.nameEn),
      p_description_zh: text(input.descriptionZh),
      p_description_en: text(input.descriptionEn),
      p_capacity: capacity,
      p_classroom: classroom || null,
      p_speaker_zh: text(input.speakerZh),
      p_speaker_en: text(input.speakerEn),
      p_highlight_id: input.highlightId || null,
    });
    return error ? failure(error) : { ok: true, id: data as string };
  }

  const values: Record<string, unknown> = {
    position,
    [`${item.name}_zh`]: nameZh,
    [`${item.name}_en`]: text(input.nameEn),
  };
  if (input.kind === "venue") {
    Object.assign(values, {
      region,
      address_zh: text(input.addressZh),
      address_en: text(input.addressEn),
      features_zh: text(input.featuresZh),
      features_en: text(input.featuresEn),
    });
  } else if (input.kind === "lunch") {
    Object.assign(values, {
      description_zh: text(input.descriptionZh),
      description_en: text(input.descriptionEn),
      capacity,
    });
  }
  // 修改時不能換上層（課程換時段在上面）；新增時一定要有上層。
  if (item.parent && input.parentId && !input.id) {
    values[item.parent] = input.parentId;
  }

  const query = input.id
    ? supabase.from(item.table).update(values).eq("id", input.id)
    : supabase.from(item.table).insert({ ...values, conference_id: input.conferenceId });
  const { data, error } = await query.select("id");
  if (error) return failure(error);
  if (data.length === 0) return { ok: false, error: "not_found" };
  return { ok: true, id: data[0].id as string };
}

/** 刪除一個項目。場地連同它的場次、課程、午餐；場次連同它的課程。 */
export async function deleteItem(supabase: SupabaseClient, kind: ItemKind, id: string): Promise<ProgrammeResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = await supabase.from(ITEMS[kind].table).delete().eq("id", id).select("id");
  if (error) return failure(error);
  return data.length === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/** 可以停止報名的選項：課程、午餐。 */
export const STOPPABLE_KINDS = ["course", "lunch"] as const satisfies readonly ItemKind[];
export type StoppableKind = (typeof STOPPABLE_KINDS)[number];

/**
 * 停止或重新開放一個選項的報名（GLOSSARY「停止報名」），隨時都可以，報名開放後也行。
 * 成對課程的兩堂由資料庫一起改。重新開放後新報名仍要通過名額檢查。
 */
export async function setRegistrationStopped(
  supabase: SupabaseClient,
  kind: StoppableKind,
  id: string,
  stopped: boolean,
): Promise<ProgrammeResult> {
  if (!id || !validIds(id)) return { ok: false, error: "not_found" };
  const { error } = await supabase.rpc("set_registration_stopped", { p_kind: kind, p_id: id, p_stopped: stopped });
  return error ? failure(error) : { ok: true };
}

/** 把同場地、連續兩個場次的兩堂課設成成對課程。 */
export async function addCoursePair(
  supabase: SupabaseClient,
  conferenceId: string,
  firstCourseId: string,
  secondCourseId: string,
): Promise<ProgrammeResult> {
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;
  if (!validIds(conferenceId, firstCourseId, secondCourseId) || firstCourseId === secondCourseId) {
    return { ok: false, error: "course_pair_invalid" };
  }

  const { error } = await supabase
    .from("course_pairs")
    .insert({ conference_id: conferenceId, first_course_id: firstCourseId, second_course_id: secondCourseId });
  return error ? failure(error) : { ok: true };
}

/** 拆開一組成對課程。 */
export async function removeCoursePair(supabase: SupabaseClient, firstCourseId: string): Promise<ProgrammeResult> {
  if (!validIds(firstCourseId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = await supabase
    .from("course_pairs")
    .delete()
    .eq("first_course_id", firstCourseId)
    .select("first_course_id");
  if (error) return failure(error);
  return data.length === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

// 表單送來的編號格式不對（網頁被改過、或是很舊的頁面），當成找不到，不必交給資料庫。空的不算。
function validIds(...ids: (string | null | undefined)[]): boolean {
  return ids.every((id) => !id || UUID_PATTERN.test(id));
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下（刪除、修改時只是找不到資料），先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: ProgrammeError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: ProgrammeError } {
  switch (true) {
    case error.message === "programme_locked":
      return { ok: false, error: "programme_locked" };
    case error.message === "not_found":
      return { ok: false, error: "not_found" };
    case error.message === "course_pair_stopped_apart":
      return { ok: false, error: "course_pair_stopped_apart" };
    case error.message === "course_pair_invalid":
    // 同一堂課已經是另一組的第一堂或第二堂。
    case error.code === "23505" && /course_pairs/.test(error.message):
      return { ok: false, error: "course_pair_invalid" };
    // 分類不是同一年度的大會特色（網頁開著時被刪掉、或網頁被改過）。
    case error.code === "23503" && /courses_highlight_same_conference/.test(error.message):
      return { ok: false, error: "highlight_invalid" };
    // 有報名（包括已取消的）指向它，外鍵擋下刪除。
    case error.code === "23503" && /registration/.test(error.message):
      return { ok: false, error: "in_use" };
    case error.message === "not_admin":
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("編輯課程安排失敗", error);
  return { ok: false, error: "unavailable" };
}

/** 後台編輯用的一個選項，中英兩欄都在。 */
export type ProgrammeItem = {
  id: string;
  position: number;
  nameZh: string;
  nameEn: string;
};

export type ProgrammeOption = ProgrammeItem & {
  descriptionZh: string;
  descriptionEn: string;
  /** null 表示不限。 */
  capacity: number | null;
  /** 停止報名（見 setRegistrationStopped）。 */
  stopped: boolean;
};

export type ProgrammeCourse = ProgrammeOption & {
  classroom: string | null;
  speakerZh: string;
  speakerEn: string;
  /** 分類（大會特色）的編號；沒有分類是 null。 */
  highlightId: string | null;
};

export type ProgrammeSession = ProgrammeItem & { courses: ProgrammeCourse[] };

export type ProgrammeVenue = ProgrammeItem & {
  region: Region;
  addressZh: string;
  addressEn: string;
  featuresZh: string;
  featuresEn: string;
  sessions: ProgrammeSession[];
  lunchOptions: ProgrammeOption[];
};

export type Programme = {
  conferenceId: string;
  year: number;
  /** 報名已開放：之後不能新增、刪除、換時段。 */
  registrationOpened: boolean;
  venues: ProgrammeVenue[];
  coursePairs: { firstCourseId: string; secondCourseId: string }[];
  /** 課程可以選的分類：目前年度的大會特色，依首頁的順序。 */
  highlights: { id: string; nameZh: string }[];
};

/** 目前年度的完整課程安排，含教室。只要一個場地時給 venueId。沒有目前年度時回傳 null。 */
export async function getProgramme(supabase: SupabaseClient, venueId?: string): Promise<Programme | null> {
  const conference = await supabase
    .from("conferences")
    .select("id, year, registration_opens_at")
    .eq("is_current", true)
    .maybeSingle();
  if (conference.error) throw conference.error;
  if (!conference.data) return null;

  const option = "id, position, description_zh, description_en, capacity, registration_stopped";
  let venueQuery = supabase
      .from("venues")
      .select(
        `id, position, region, name_zh, name_en, address_zh, address_en, features_zh, features_en,
        sessions(id, position, name_zh, name_en, courses(
          ${option}, title_zh, title_en, speaker_zh, speaker_en, highlight_id, course_classrooms(classroom)
        )),
        lunch_options(${option}, name_zh, name_en)`,
      )
      .eq("conference_id", conference.data.id);
  if (venueId) venueQuery = venueQuery.eq("id", venueId);
  const [venues, pairs, highlights] = await Promise.all([
    venueQuery
      .order("position")
      .order("id")
      .order("position", { referencedTable: "sessions" })
      .order("id", { referencedTable: "sessions" })
      .order("position", { referencedTable: "sessions.courses" })
      .order("id", { referencedTable: "sessions.courses" })
      .order("position", { referencedTable: "lunch_options" })
      .order("id", { referencedTable: "lunch_options" }),
    supabase
      .from("course_pairs")
      .select("first_course_id, second_course_id")
      .eq("conference_id", conference.data.id)
      .order("created_at"),
    supabase
      .from("highlights")
      .select("id, name_zh")
      .eq("conference_id", conference.data.id)
      .order("position")
      .order("id"),
  ]);
  if (venues.error) throw venues.error;
  if (pairs.error) throw pairs.error;
  if (highlights.error) throw highlights.error;

  type OptionRow = {
    id: string;
    position: number;
    description_zh: string;
    description_en: string;
    capacity: number | null;
    registration_stopped: boolean;
  };
  const toOption = (row: OptionRow, nameZh: string, nameEn: string): ProgrammeOption => ({
    id: row.id,
    position: row.position,
    nameZh,
    nameEn,
    descriptionZh: row.description_zh,
    descriptionEn: row.description_en,
    capacity: row.capacity,
    stopped: row.registration_stopped,
  });

  const opensAt = conference.data.registration_opens_at;
  return {
    conferenceId: conference.data.id,
    year: conference.data.year,
    registrationOpened: opensAt !== null && new Date(opensAt) <= new Date(),
    venues: venues.data.map((venue) => ({
      id: venue.id,
      position: venue.position,
      nameZh: venue.name_zh,
      nameEn: venue.name_en,
      region: venue.region,
      addressZh: venue.address_zh,
      addressEn: venue.address_en,
      featuresZh: venue.features_zh,
      featuresEn: venue.features_en,
      sessions: venue.sessions.map((session) => ({
        id: session.id,
        position: session.position,
        nameZh: session.name_zh,
        nameEn: session.name_en,
        courses: session.courses.map((course) => ({
          ...toOption(course, course.title_zh, course.title_en),
          // 一門課最多一間教室（course_id 是主鍵），所以是單一物件或 null。
          classroom: (course.course_classrooms as unknown as { classroom: string } | null)?.classroom ?? null,
          speakerZh: course.speaker_zh,
          speakerEn: course.speaker_en,
          highlightId: course.highlight_id,
        })),
      })),
      lunchOptions: venue.lunch_options.map((lunch) => toOption(lunch, lunch.name_zh, lunch.name_en)),
    })),
    coursePairs: pairs.data.map((pair) => ({
      firstCourseId: pair.first_course_id,
      secondCourseId: pair.second_course_id,
    })),
    highlights: highlights.data.map((highlight) => ({ id: highlight.id, nameZh: highlight.name_zh })),
  };
}
