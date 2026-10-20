import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "./i18n/locale";
import { trimBlank, UUID_PATTERN } from "./registration";

/*
 * 首頁主視覺圖片（#81）：每個年度最多四張，手機版 4:5、電腦版 3:1，各有中文、英文，都可有可無。
 * 圖片由後台的瀏覽器直接上傳到存放空間 hero-images（Vercel 的伺服器收不了這麼大的檔案），
 * 上傳完再把路徑記到年度大會上；換圖、刪圖時順便刪掉舊檔。只有總管理員能上傳、刪除、記路徑，
 * 由存放空間與資料庫的權限規則強制（ADR 0004）；這裡先確認一次，好在畫面上說明。
 */

export const HERO_BUCKET = "hero-images";

/** 四個位置：手機版、電腦版各有中文、英文。 */
export const HERO_SLOTS = ["mobileZh", "mobileEn", "desktopZh", "desktopEn"] as const;
export type HeroSlot = (typeof HERO_SLOTS)[number];

/** 每個位置存在哪一欄、檔名開頭是什麼（和資料庫 conferences_hero_paths_valid 一致）。 */
const SLOTS: Record<HeroSlot, { column: string; prefix: string }> = {
  mobileZh: { column: "hero_mobile_zh_path", prefix: "mobile-zh" },
  mobileEn: { column: "hero_mobile_en_path", prefix: "mobile-en" },
  desktopZh: { column: "hero_desktop_zh_path", prefix: "desktop-zh" },
  desktopEn: { column: "hero_desktop_en_path", prefix: "desktop-en" },
};

/** 單張上限 5 MB，和存放空間的設定一致。 */
export const HERO_MAX_BYTES = 5 * 1024 * 1024;

/** 收的格式與副檔名，和存放空間的設定一致。 */
const HERO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** 建議的長寬比（寬 ÷ 高）：手機版 4:5、電腦版 3:1。 */
const HERO_RATIOS: Record<HeroSlot, number> = { mobileZh: 4 / 5, mobileEn: 4 / 5, desktopZh: 3, desktopEn: 3 };

export type HeroError =
  | "not_admin"
  | "file_type"
  | "file_too_large"
  | "alt_required"
  | "upload_failed"
  | "not_found"
  | "unavailable";

export type HeroResult = { ok: true } | { ok: false; error: HeroError };

/** 上傳前檢查格式與大小；沒問題是 null。 */
export function checkHeroFile(type: string, size: number): HeroError | null {
  if (!(type in HERO_TYPES)) return "file_type";
  if (size > HERO_MAX_BYTES) return "file_too_large";
  return null;
}

/** 長寬比和建議的差超過一成時提醒（不擋，美編組的圖可能刻意不同）。 */
export function heroRatioOff(slot: HeroSlot, width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height / HERO_RATIOS[slot] - 1) > 0.1;
}

/** 新上傳的檔案路徑：<年度大會編號>/<位置>-<隨機編號>.<副檔名>。每次都是新檔名，換圖後不會拿到快取的舊圖。 */
export function heroImagePath(conferenceId: string, slot: HeroSlot, type: string): string {
  return `${conferenceId}/${SLOTS[slot].prefix}-${crypto.randomUUID()}.${HERO_TYPES[type]}`;
}

function isHeroPath(conferenceId: string, slot: HeroSlot, path: string): boolean {
  return new RegExp(`^${conferenceId}/${SLOTS[slot].prefix}-[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(path);
}

/** 公開網址。 */
export function heroImageUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(HERO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** 把剛上傳的圖記到目前年度的某個位置；原本的圖一併刪掉。 */
export async function attachHeroImage(
  supabase: SupabaseClient,
  input: { conferenceId: string; slot: HeroSlot; path: string },
): Promise<HeroResult> {
  if (!HERO_SLOTS.includes(input.slot) || !UUID_PATTERN.test(input.conferenceId)) return { ok: false, error: "not_found" };
  if (!isHeroPath(input.conferenceId, input.slot, input.path)) return { ok: false, error: "upload_failed" };
  return replaceHeroImage(supabase, input.conferenceId, input.slot, input.path);
}

/** 刪掉目前年度某個位置的圖。 */
export async function removeHeroImage(
  supabase: SupabaseClient,
  input: { conferenceId: string; slot: HeroSlot },
): Promise<HeroResult> {
  if (!HERO_SLOTS.includes(input.slot) || !UUID_PATTERN.test(input.conferenceId)) return { ok: false, error: "not_found" };
  return replaceHeroImage(supabase, input.conferenceId, input.slot, null);
}

async function replaceHeroImage(
  supabase: SupabaseClient,
  conferenceId: string,
  slot: HeroSlot,
  path: string | null,
): Promise<HeroResult> {
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const column = SLOTS[slot].column;
  const current = await supabase.from("conferences").select(column).eq("id", conferenceId).eq("is_current", true).maybeSingle();
  if (current.error) return failure(current.error);
  if (!current.data) return { ok: false, error: "not_found" };
  const previous = (current.data as unknown as Record<string, string | null>)[column];

  // 頁面開著時目前年度換了，不能改到舊年度（和首頁內容一樣，見 src/lib/content.ts）。
  const { data, error } = await supabase
    .from("conferences")
    .update({ [column]: path, updated_at: new Date().toISOString() })
    .eq("id", conferenceId)
    .eq("is_current", true)
    .select("id");
  if (error) return failure(error);
  if (data.length === 0) return { ok: false, error: "not_found" };

  // 舊檔刪不掉只是多佔空間，首頁已經換了，不算失敗。
  if (previous && previous !== path) {
    const removed = await supabase.storage.from(HERO_BUCKET).remove([previous]);
    if (removed.error) console.error("刪除舊的主視覺圖片失敗", previous, removed.error);
  }
  return { ok: true };
}

/** 儲存圖片說明。有圖時中文必填（資料庫 conferences_hero_alt_required）。 */
export async function saveHeroAlt(
  supabase: SupabaseClient,
  input: { conferenceId: string; altZh: string; altEn: string },
): Promise<HeroResult> {
  if (!UUID_PATTERN.test(input.conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = await supabase
    .from("conferences")
    .update({ hero_alt_zh: trimBlank(input.altZh), hero_alt_en: trimBlank(input.altEn), updated_at: new Date().toISOString() })
    .eq("id", input.conferenceId)
    .eq("is_current", true)
    .select("id");
  if (error) return failure(error);
  return data.length === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下，先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: HeroError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

function failure(error: PostgrestError): { ok: false; error: HeroError } {
  if (error.code === "23514" && error.message.includes("conferences_hero_alt_required")) {
    return { ok: false, error: "alt_required" };
  }
  if (error.code === "23514" && error.message.includes("conferences_hero_paths_valid")) {
    return { ok: false, error: "upload_failed" };
  }
  if (error.code === "42501") return { ok: false, error: "not_admin" };
  console.error("編輯主視覺失敗", error);
  return { ok: false, error: "unavailable" };
}

/** 資料庫裡四個位置的路徑。 */
export type HeroPaths = Record<HeroSlot, string | null>;

/** 從年度大會的一列讀出四個位置的路徑。 */
export function heroPathsOf(row: Record<string, unknown>): HeroPaths {
  return Object.fromEntries(HERO_SLOTS.map((slot) => [slot, (row[SLOTS[slot].column] as string | null) ?? null])) as HeroPaths;
}

/**
 * 首頁要顯示的圖（路徑）：英文版沒有英文圖就用中文圖；中文版只用中文圖。
 * 電腦版沒有就用手機版，手機版沒有就用電腦版。都沒有時是 null（首頁改用文字顯示主題經文）。
 */
export function pickHeroPaths(paths: HeroPaths, locale: Locale): { mobile: string; desktop: string } | null {
  const pick = (form: "mobile" | "desktop") =>
    (locale === "en" ? paths[`${form}En`] : null) ?? paths[`${form}Zh`];
  const mobile = pick("mobile") ?? pick("desktop");
  const desktop = pick("desktop") ?? pick("mobile");
  return mobile && desktop ? { mobile, desktop } : null;
}
