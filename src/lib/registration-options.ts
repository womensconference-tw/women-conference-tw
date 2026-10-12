import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "./i18n/locale";
import { localized } from "./i18n/localized";

export type VenueOption = { id: string; name: string };

export type WardOption = {
  id: string;
  /** 依語言挑好的名稱。 */
  name: string;
  /** 搜尋用：中英文名稱都能找到。 */
  nameZh: string;
  nameEn: string;
};

export type StakeOption = { id: string; name: string; wards: WardOption[] };

/** 報名表可選的場地、支聯會與支會，已依語言挑好名稱。 */
export type RegistrationOptions = { venues: VenueOption[]; stakes: StakeOption[] };

/**
 * 讀取報名表的選項：目前年度的場地，與啟用中的支聯會、支會（停用的由資料庫權限規則擋掉）。
 * 沒有任何啟用中支會的支聯會不列出，免得選了之後沒有支會可選。
 * 都依排序列出，排序相同時依 id，讓順序每次都一樣。
 */
export async function getRegistrationOptions(
  supabase: SupabaseClient,
  locale: Locale,
): Promise<RegistrationOptions> {
  const [venues, stakes] = await Promise.all([
    supabase
      .from("venues")
      .select("id, name_zh, name_en, conferences!inner(is_current)")
      .eq("conferences.is_current", true)
      .order("position")
      .order("id"),
    supabase
      .from("stakes")
      .select("id, name_zh, name_en, wards(id, name_zh, name_en)")
      .order("position")
      .order("id")
      .order("position", { referencedTable: "wards" })
      .order("id", { referencedTable: "wards" }),
  ]);
  if (venues.error) throw venues.error;
  if (stakes.error) throw stakes.error;

  return {
    venues: venues.data.map((venue) => ({ id: venue.id, name: localized(venue, "name", locale) })),
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
