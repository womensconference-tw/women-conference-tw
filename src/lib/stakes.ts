import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { trimBlank, UUID_PATTERN } from "./registration";
import { REGIONS, type Region } from "./staff";

/*
 * 支聯會與支會名單（#23）：不屬於任何年度大會，只有總管理員能維護，由資料庫的權限規則強制（ADR 0004）。
 * 重新劃分時停用舊支會、在新的支聯會新增：支會不能改隸屬的支聯會（資料庫也擋）。支聯會可以直接改區（#24）。
 * 有報名的單位不能刪除，只能停用；停用的不出現在前台報名表，舊報名、統計與名單照常顯示。
 */

export type StakeError =
  | "name_required"
  | "position_invalid"
  | "region_required"
  | "in_use"
  | "not_found"
  | "not_admin"
  | "unavailable";

export type StakeResult = { ok: true } | { ok: false; error: StakeError };

export type DirectoryWard = {
  id: string;
  position: number;
  nameZh: string;
  nameEn: string;
  isActive: boolean;
};

export type DirectoryStake = {
  id: string;
  position: number;
  nameZh: string;
  nameEn: string;
  region: Region;
  isActive: boolean;
  wards: DirectoryWard[];
};

/** 後台名單：全部的支聯會與支會（含停用的），依排序列出。 */
export type StakeDirectory = { stakes: DirectoryStake[] };

export async function getStakeDirectory(supabase: SupabaseClient): Promise<StakeDirectory> {
  const stakes = await supabase
    .from("stakes")
    .select("id, position, name_zh, name_en, region, is_active, wards(id, position, name_zh, name_en, is_active)")
    .order("position")
    .order("id")
    .order("position", { referencedTable: "wards" })
    .order("id", { referencedTable: "wards" });
  if (stakes.error) throw stakes.error;
  return {
    stakes: stakes.data.map((stake) => ({
      id: stake.id,
      position: stake.position,
      nameZh: stake.name_zh,
      nameEn: stake.name_en,
      region: stake.region,
      isActive: stake.is_active,
      wards: stake.wards.map((ward) => ({
        id: ward.id,
        position: ward.position,
        nameZh: ward.name_zh,
        nameEn: ward.name_en,
        isActive: ward.is_active,
      })),
    })),
  };
}

export type StakeInput = {
  /** 修改時帶入；新增時不帶。 */
  id?: string;
  nameZh: string;
  nameEn: string;
  /** 新增時必填；修改時不帶就不改。 */
  region?: string;
  /** 表單上的原始文字；空白是 0。 */
  position: string;
};

/**
 * 新增或修改支聯會的名稱、區與排序。改區後，這個支聯會的報名在名單上算新的區
 * （報報組的範圍、跨區標記都跟著換）。
 */
export async function saveStake(
  supabase: SupabaseClient,
  input: StakeInput,
): Promise<{ ok: true; id: string } | { ok: false; error: StakeError }> {
  const parsed = unitValues(input);
  if (!parsed.ok) return parsed;
  const { values } = parsed;
  if (!validIds(input.id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;
  if (!input.id || input.region !== undefined) {
    const region = REGIONS.find((candidate) => candidate === input.region);
    if (!region) return { ok: false, error: "region_required" };
    values.region = region;
  }
  if (!input.id) return saved(await supabase.from("stakes").insert(values).select("id"));
  return saved(await supabase.from("stakes").update(values).eq("id", input.id).select("id"));
}

export type WardInput = {
  /** 修改時帶入；新增時不帶。 */
  id?: string;
  /** 只在新增時用；既有支會不能改隸屬的支聯會。 */
  stakeId?: string;
  nameZh: string;
  nameEn: string;
  position: string;
};

/** 新增或修改支會的名稱與排序。所屬支聯會只在新增時設定。 */
export async function saveWard(
  supabase: SupabaseClient,
  input: WardInput,
): Promise<{ ok: true; id: string } | { ok: false; error: StakeError }> {
  const parsed = unitValues(input);
  if (!parsed.ok) return parsed;
  const { values } = parsed;
  if (!validIds(input.id, input.stakeId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;
  if (!input.id) {
    if (!input.stakeId) return { ok: false, error: "not_found" };
    return saved(await supabase.from("wards").insert({ ...values, stake_id: input.stakeId }).select("id"));
  }
  return saved(await supabase.from("wards").update(values).eq("id", input.id).select("id"));
}

export type UnitKind = "stake" | "ward";

const TABLES: Record<UnitKind, string> = { stake: "stakes", ward: "wards" };

/**
 * 停用或重新啟用支聯會、支會。停用的不出現在前台報名表（停用支聯會時它的支會也一起不出現），
 * 舊報名、統計與名單照常顯示。
 */
export async function setUnitActive(
  supabase: SupabaseClient,
  kind: UnitKind,
  id: string,
  active: boolean,
): Promise<StakeResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;
  const result = saved(
    await supabase
      .from(TABLES[kind])
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id"),
  );
  return result.ok ? { ok: true } : result;
}

/** 刪除支聯會（連同它的支會）或支會。有報名（包括已取消的）或籌備委員會名單指向它時不能刪除，可以改成停用。 */
export async function deleteUnit(supabase: SupabaseClient, kind: UnitKind, id: string): Promise<StakeResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;
  const result = saved(await supabase.from(TABLES[kind]).delete().eq("id", id).select("id"));
  return result.ok ? { ok: true } : result;
}

// 名稱與排序，支聯會和支會共用。
function unitValues(input: { nameZh: string; nameEn: string; position: string }):
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: StakeError } {
  const nameZh = trimBlank(input.nameZh);
  if (!nameZh) return { ok: false, error: "name_required" };
  const position = trimBlank(input.position);
  if (position !== "" && !/^-?[0-9]{1,6}$/.test(position)) return { ok: false, error: "position_invalid" };
  return {
    ok: true,
    values: {
      name_zh: nameZh,
      name_en: trimBlank(input.nameEn),
      position: Number(position),
      updated_at: new Date().toISOString(),
    },
  };
}

// 新增、修改後回傳的列。課務組、報報組、訪客的修改被權限規則擋下時，新增會出錯，修改則是一列都沒改到。
function saved(result: { data: { id: string }[] | null; error: PostgrestError | null }) {
  if (result.error) return failure(result.error);
  if (!result.data || result.data.length === 0) return { ok: false as const, error: "not_found" as const };
  return { ok: true as const, id: result.data[0].id };
}

// 表單送來的編號格式不對（網頁被改過、或是很舊的頁面），當成找不到，不必交給資料庫。空的不算。
function validIds(...ids: (string | null | undefined)[]): boolean {
  return ids.every((id) => !id || UUID_PATTERN.test(id));
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下（修改、刪除時只是找不到資料），先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: StakeError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: StakeError } {
  switch (true) {
    // 有報名（包括已取消的）、籌備委員會名單（#45）或大會特色介紹頁的人物指向它，外鍵擋下刪除。
    case error.code === "23503" && /registrations|committee_|highlight_people/.test(error.message):
      return { ok: false, error: "in_use" };
    // 新增支會時，支聯會不存在。
    case error.code === "23503":
      return { ok: false, error: "not_found" };
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("編輯支聯會名單失敗", error);
  return { ok: false, error: "unavailable" };
}
