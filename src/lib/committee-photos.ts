import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommitteeError } from "./committee";

/*
 * 籌備委員個人頁的照片。後台的瀏覽器直接上傳到存放空間 committee-photos（Vercel 的伺服器收不了這麼大的檔案），
 * 上傳完再請伺服器把路徑記到這位委員上（src/lib/committee.ts 的 attachCommitteePhoto）；換照片、刪照片、刪委員時順便刪掉舊檔。
 * 只有總管理員能上傳、刪除，由存放空間與資料庫的權限規則強制（ADR 0004）；這裡先檢查一次格式與大小，好說明原因。
 * 名單不複製到新年度，每張照片只屬於一位委員，刪掉不會讓別的年度破圖。
 */

export const COMMITTEE_PHOTO_BUCKET = "committee-photos";

/** 單張上限 5 MB，和存放空間的設定一致。 */
export const COMMITTEE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** 收的格式與副檔名，和存放空間的設定一致。 */
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type CommitteePhotoFileError = "file_type" | "file_too_large";

/** 上傳前檢查格式與大小；沒問題是 null。 */
export function checkCommitteePhoto(type: string, size: number): CommitteePhotoFileError | null {
  if (!(type in PHOTO_TYPES)) return "file_type";
  if (size > COMMITTEE_PHOTO_MAX_BYTES) return "file_too_large";
  return null;
}

/**
 * 新上傳的檔案路徑：<年度大會編號>/<籌備委員編號>-<隨機編號>.<副檔名>（和資料庫 committee_members_photo_path_valid 一致）。
 * 每次都是新檔名，換照片後不會拿到快取的舊照片。
 */
export function committeePhotoPath(conferenceId: string, memberId: string, type: string): string {
  return `${conferenceId}/${memberId}-${crypto.randomUUID()}.${PHOTO_TYPES[type]}`;
}

/** 是不是這位委員的照片路徑。年度的部分由資料庫比對。 */
export function isCommitteePhotoPath(memberId: string, path: string): boolean {
  return new RegExp(`^[0-9a-f-]{36}/${memberId}-[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(path);
}

/**
 * 後台記不成功時，能不能刪掉剛上傳的檔案：只有確定沒記上的才能刪。
 * 「系統出了問題」時可能已經記好了，刪掉的話個人頁會破圖。
 */
export function committeePhotoNotRecorded(error: CommitteeError): boolean {
  return error !== "unavailable";
}

/** 公開網址。 */
export function committeePhotoUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(COMMITTEE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** 刪掉換下來的照片。刪不掉只是多佔空間，頁面已經換了，不算失敗。 */
export async function removeCommitteePhotoFile(supabase: SupabaseClient, path: string): Promise<void> {
  try {
    const removed = await supabase.storage.from(COMMITTEE_PHOTO_BUCKET).remove([path]);
    if (removed.error) console.error("刪除籌備委員的舊照片失敗", path, removed.error);
  } catch (error) {
    console.error("刪除籌備委員的舊照片失敗", path, error);
  }
}
