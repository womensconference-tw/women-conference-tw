"use server";

import { refresh } from "next/cache";
import { submitRegistration, type RegistrationInput, type SubmitResult } from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/** 報名表送出。用匿名訪客的身分呼叫報名服務；是否報名中等規則由資料庫判斷。 */
export async function register(input: RegistrationInput): Promise<SubmitResult> {
  const supabase = await createClient();
  const result = await submitRegistration(supabase, sanitize(input));
  // 課程剛額滿，或場次、課程在她填表時有變動：重新讀取頁面上的選項，選課步驟才會顯示最新狀態。
  // 已填的資料留在瀏覽器裡，不受影響。
  if (!result.ok && result.errors.courses) refresh();
  return result;
}

// 任何人都能直接打這個動作，送來的不一定是報名表的形狀；型別不對的一律當成空白，交給欄位檢查擋下。
function sanitize(input: unknown): RegistrationInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  return {
    name: text("name"),
    phone: text("phone"),
    noPhone: raw.noPhone === true,
    email: text("email"),
    lineId: text("lineId"),
    stakeId: text("stakeId"),
    wardId: text("wardId"),
    venueId: text("venueId"),
    // 不是字串的課程換成空字串，交給欄位檢查擋下。
    courseIds: Array.isArray(raw.courseIds)
      ? raw.courseIds.map((id) => (typeof id === "string" ? id : ""))
      : [],
    portraitConsent: raw.portraitConsent === true,
  };
}
