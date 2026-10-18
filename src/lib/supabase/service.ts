import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * 網站伺服器專用的資料庫連線，用秘密金鑰（SUPABASE_SECRET_KEY）。
 * 查詢、修改、取消報名的資料庫函式只開放給這個身分（ADR 0009）：
 * 訪客不能直接呼叫、對回傳值加篩選或轉型，猜錯次數才擋得住一直猜。
 * 只能用來呼叫報名服務固定的函式，不能拿來讀寫資料表。
 * 另外，後台新增、移除工作人員時用它建立、刪除登入帳號（資料庫裡沒辦法做），
 * 而且要先由資料庫確認操作的人是總管理員（src/lib/staff.ts）。後台重寄確認信也一樣（src/lib/email-logs.ts）。
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("沒有設定 SUPABASE_SECRET_KEY，查詢、修改、取消報名與管理工作人員帳號無法使用。");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
