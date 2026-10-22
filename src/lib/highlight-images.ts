/*
 * 大會特色介紹內容與教堂分頁裡的圖片（#102）。後台編輯器的「圖片」按鈕由瀏覽器直接上傳到存放空間
 * highlight-images（Vercel 的伺服器收不了這麼大的檔案），再把公開網址寫進 Markdown（![圖片說明](網址)）。
 * 只有總管理員能上傳，由存放空間的權限規則強制（ADR 0004）；這裡先檢查一次格式與大小，好說明原因。
 * 介紹頁只顯示這個存放空間的圖片，貼上別的網站的圖片不會顯示。
 *
 * 介紹頁人物版型的照片也放這裡，資料庫存的是路徑。
 *
 * 上傳了沒存、或之後從內容拿掉的圖片（含換下來的人物照片）不會自動刪除：複製建立新年度時介紹內容跟著複製，新舊年度用的是同一個檔案，
 * 刪了會讓另一個年度破圖。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const HIGHLIGHT_IMAGE_BUCKET = "highlight-images";

/** 單張上限 5 MB，和存放空間的設定一致。 */
export const HIGHLIGHT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 收的格式與副檔名，和存放空間的設定一致。 */
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type HighlightImageError = "file_type" | "file_too_large";

/** 上傳前檢查格式與大小；沒問題是 null。 */
export function checkHighlightImage(type: string, size: number): HighlightImageError | null {
  if (!(type in IMAGE_TYPES)) return "file_type";
  if (size > HIGHLIGHT_IMAGE_MAX_BYTES) return "file_too_large";
  return null;
}

/** 新上傳的檔案路徑：<年度大會編號>/<隨機編號>.<副檔名>。 */
export function highlightImagePath(conferenceId: string, type: string): string {
  return `${conferenceId}/${crypto.randomUUID()}.${IMAGE_TYPES[type]}`;
}

const IMAGE_FILE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** 是不是上傳到 highlight-images 的檔案路徑（介紹頁人物的照片存路徑，和資料庫 highlight_people_photo_path_valid 一致）。 */
export function isHighlightImagePath(path: string): boolean {
  return IMAGE_FILE.test(path);
}

/** 檔案路徑的公開網址。 */
export function highlightImageUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(HIGHLIGHT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** 是不是從後台上傳到 highlight-images 的圖片的公開網址。 */
export function isHighlightImageUrl(url: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!base) return false;
  const prefix = `${base}/storage/v1/object/public/${HIGHLIGHT_IMAGE_BUCKET}/`;
  return url.startsWith(prefix) && IMAGE_FILE.test(url.slice(prefix.length));
}
