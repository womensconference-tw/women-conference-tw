import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizePhone,
  trimBlank,
  UUID_PATTERN,
  type ChoirPart,
  type RegistrantRole,
  type Registration,
  type Service,
} from "./registration";

/*
 * 後台報名名單（ADR 0004）：用登入的工作人員身分直接讀報名資料表，
 * 讀得到哪些由資料庫的權限規則決定（總管理員與全區的報報組全部；課務組報名該區教堂的；報報組另加該區支聯會報名別區教堂的）。
 */

export type RegistrationStatus = "registered" | "cancelled";

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  registered: "有效",
  cancelled: "已取消",
};

/** 清除個資（#26）之後姓名是空的，名單與報名頁改顯示這句。 */
export const CLEARED_NAME = "（個資已清除）";

export type RegistrationListItem = {
  id: string;
  /** 清除個資之後是 CLEARED_NAME。 */
  name: string;
  phone: string | null;
  registrationNumber: string | null;
  venueName: string;
  stakeName: string;
  wardName: string;
  status: RegistrationStatus;
  role: RegistrantRole;
  createdAt: string;
  /** 所選場地的區與支聯會的區不同（#24）。 */
  crossRegion: boolean;
  /** 同一年度、同一支會另有姓名相同的有效報名；已取消的一律是 false（#24）。 */
  suspectedDuplicate: boolean;
};

/** 名單只列出某一種：疑似重複（同一支會、同名的排在一起）或有效的跨區報名。 */
export type RegistrationFilter = "duplicates" | "cross_region";

export function isRegistrationFilter(value: unknown): value is RegistrationFilter {
  return value === "duplicates" || value === "cross_region";
}

/** 一次最多列出的筆數；超過時請用搜尋縮小範圍。 */
export const LIST_LIMIT = 200;

/**
 * 某個年度（`year`，沒給是目前年度）、自己範圍內的報名，新的在前。舊年度的名單也照同樣的範圍。`query` 空白時列出全部；
 * 整理後只剩數字（可有開頭的 +）時找電話或報名編號，否則找姓名。都是部分相符。
 * `total` 是符合的總筆數，可能比列出的多（見 LIST_LIMIT）。
 * 給了 `filter` 時只列出疑似重複或跨區的報名（見 RegistrationFilter）。疑似重複和跨區都只在自己範圍內比對。
 */
export async function listRegistrations(
  supabase: SupabaseClient,
  query: string,
  year?: number,
  filter?: RegistrationFilter,
): Promise<{ items: RegistrationListItem[]; total: number }> {
  let request = supabase
    .from("registrations")
    .select(
      "id, name, phone, registration_number, status, role, created_at, is_cross_region, is_suspected_duplicate, venues(name_zh), stakes(name_zh), wards(name_zh), conferences!inner(year, is_current)",
      { count: "exact" },
    );
  request = year === undefined ? request.eq("conferences.is_current", true) : request.eq("conferences.year", year);

  const text = trimBlank(query);
  const phone = normalizePhone(text);
  if (/^\+?\d+$/.test(phone)) {
    // 只有數字和 +，放進 or 條件不會被當成語法。
    request = request.or(
      [`phone.like.*${phone}*`, ...taiwanPrefixSwap(phone), `registration_number.like.*${phone}*`].join(","),
    );
  } else if (text) {
    request = request.ilike("name", `%${escapeLike(text)}%`);
  }

  if (filter === "duplicates") {
    // 同一支會、同名（只差空白或大小寫也算）的排在一起。
    request = request.eq("is_suspected_duplicate", true).order("ward_id").order("name_key");
  } else if (filter === "cross_region") {
    // 只看還要來的人；已取消的在一般名單上仍標著跨區。
    request = request.eq("is_cross_region", true).eq("status", "registered");
  }

  const { data, count, error } = await request.order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (error) throw error;

  return {
    items: (data as unknown as RegistrationRow[]).map((row) => ({
      id: row.id,
      name: row.name ?? CLEARED_NAME,
      phone: row.phone,
      registrationNumber: row.registration_number,
      venueName: row.venues?.name_zh ?? "",
      stakeName: row.stakes?.name_zh ?? "",
      wardName: row.wards?.name_zh ?? "",
      status: row.status,
      role: row.role,
      createdAt: row.created_at,
      crossRegion: row.is_cross_region,
      suspectedDuplicate: row.is_suspected_duplicate,
    })),
    total: count ?? 0,
  };
}

type RegistrationRow = {
  id: string;
  name: string | null;
  phone: string | null;
  registration_number: string | null;
  status: RegistrationStatus;
  role: RegistrantRole;
  created_at: string;
  is_cross_region: boolean;
  is_suspected_duplicate: boolean;
  venues: { name_zh: string } | null;
  stakes: { name_zh: string } | null;
  wards: { name_zh: string } | null;
};

/** 後台修改報名時讀出的一筆：存下的內容，加上身分類別、狀態、支聯會與支會名稱、是不是目前年度。 */
export type RegistrationForEdit = Registration & {
  role: RegistrantRole;
  status: RegistrationStatus;
  stakeName: string;
  wardName: string;
  /** 只有目前年度的報名能修改、取消。 */
  isCurrentYear: boolean;
  /** 這個年度已經清除個資（#26）：姓名是 CLEARED_NAME，不能修改、取消或重寄。 */
  personalDataCleared: boolean;
};

/** 用登入的工作人員身分讀一筆報名；範圍外、不存在或編號格式不對時是 null。 */
export async function getRegistrationForEdit(
  supabase: SupabaseClient,
  id: string,
): Promise<RegistrationForEdit | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const { data, error } = await supabase
    .from("registrations")
    .select(
      "id, name, phone, registration_number, email, line_id, stake_id, ward_id, venue_id, lunch_option_id, choir_part, services, printed_handbook, role, status, stakes(name_zh), wards(name_zh), conferences(is_current, personal_data_cleared_at), registration_courses(course_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as EditRow;
  return {
    id: row.id,
    name: row.name ?? CLEARED_NAME,
    phone: row.phone,
    registrationNumber: row.registration_number,
    email: row.email,
    lineId: row.line_id,
    stakeId: row.stake_id,
    wardId: row.ward_id,
    venueId: row.venue_id,
    courseIds: row.registration_courses.map((course) => course.course_id).toSorted(),
    lunchOptionId: row.lunch_option_id,
    choirPart: row.choir_part,
    services: row.services,
    printedHandbook: row.printed_handbook,
    role: row.role,
    status: row.status,
    stakeName: row.stakes?.name_zh ?? "",
    wardName: row.wards?.name_zh ?? "",
    isCurrentYear: row.conferences?.is_current ?? false,
    personalDataCleared: Boolean(row.conferences?.personal_data_cleared_at),
  };
}

type EditRow = {
  id: string;
  name: string | null;
  phone: string | null;
  registration_number: string | null;
  email: string | null;
  line_id: string | null;
  stake_id: string;
  ward_id: string;
  venue_id: string;
  lunch_option_id: string | null;
  choir_part: ChoirPart | null;
  services: Service[];
  printed_handbook: boolean;
  role: RegistrantRole;
  status: RegistrationStatus;
  stakes: { name_zh: string } | null;
  wards: { name_zh: string } | null;
  conferences: { is_current: boolean; personal_data_cleared_at: string | null } | null;
  registration_courses: { course_id: string }[];
};

/**
 * 台灣號碼存的可能是 09… 或 +8869…。輸入以 0 或 +886 開頭時，另外找以另一種寫法開頭的號碼。
 * 只比對號碼開頭，不會找到其他國家（例如 +81 9…）或不含這段數字的號碼。
 */
function taiwanPrefixSwap(phone: string): string[] {
  if (phone.startsWith("+886") && phone.length > 4) return [`phone.like.0${phone.slice(4)}*`];
  if (phone.startsWith("0") && phone.length > 1) return [`phone.like.+886${phone.slice(1)}*`];
  return [];
}

// 搜尋字裡的 %、_ 是一般文字，不是萬用字元。* 沒辦法跳脫（PostgREST 一律當成 %），
// 只會在自己範圍內多找到幾筆，範圍內的本來就能全部列出，不另外處理。
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
