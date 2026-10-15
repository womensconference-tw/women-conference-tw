import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, trimBlank } from "./registration";

/*
 * 後台報名名單（ADR 0004）：用登入的工作人員身分直接讀報名資料表，
 * 讀得到哪些由資料庫的權限規則決定（總管理員全部、教堂承辦自己的場地、支聯會承辦自己的支聯會）。
 */

export type RegistrationStatus = "registered" | "cancelled";

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  registered: "有效",
  cancelled: "已取消",
};

export type RegistrationListItem = {
  id: string;
  name: string;
  phone: string | null;
  registrationNumber: string | null;
  venueName: string;
  stakeName: string;
  wardName: string;
  status: RegistrationStatus;
  createdAt: string;
};

/** 一次最多列出的筆數；超過時請用搜尋縮小範圍。 */
export const LIST_LIMIT = 200;

/**
 * 目前年度、自己範圍內的報名，新的在前。`query` 空白時列出全部；
 * 整理後只剩數字（可有開頭的 +）時找電話或報名編號，否則找姓名。都是部分相符。
 * `total` 是符合的總筆數，可能比列出的多（見 LIST_LIMIT）。
 */
export async function listRegistrations(
  supabase: SupabaseClient,
  query: string,
): Promise<{ items: RegistrationListItem[]; total: number }> {
  let request = supabase
    .from("registrations")
    .select(
      "id, name, phone, registration_number, status, created_at, venues(name_zh), stakes(name_zh), wards(name_zh), conferences!inner(is_current)",
      { count: "exact" },
    )
    .eq("conferences.is_current", true);

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

  const { data, count, error } = await request.order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (error) throw error;

  return {
    items: (data as unknown as RegistrationRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      registrationNumber: row.registration_number,
      venueName: row.venues?.name_zh ?? "",
      stakeName: row.stakes?.name_zh ?? "",
      wardName: row.wards?.name_zh ?? "",
      status: row.status,
      createdAt: row.created_at,
    })),
    total: count ?? 0,
  };
}

type RegistrationRow = {
  id: string;
  name: string;
  phone: string | null;
  registration_number: string | null;
  status: RegistrationStatus;
  created_at: string;
  venues: { name_zh: string } | null;
  stakes: { name_zh: string } | null;
  wards: { name_zh: string } | null;
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
