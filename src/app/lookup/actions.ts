"use server";

import { getLocale } from "@/lib/i18n/server";
import { lookupRegistration, type LookupResult } from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/** 查詢表單送出。用匿名訪客的身分呼叫報名服務；比對由資料庫函式負責。 */
export async function lookUp(input: unknown): Promise<LookupResult> {
  // 任何人都能直接打這個動作，送來的不一定是表單的形狀；不是字串的當成空白，交給欄位檢查擋下。
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const supabase = await createClient();
  return lookupRegistration(
    supabase,
    { name: text("name"), phoneOrNumber: text("phoneOrNumber") },
    await getLocale(),
  );
}
