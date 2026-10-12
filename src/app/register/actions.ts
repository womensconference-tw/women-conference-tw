"use server";

import { refresh } from "next/cache";
import { submitRegistration, type RegistrationInput, type SubmitResult } from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/** 報名表送出。用匿名訪客的身分呼叫報名服務；是否報名中等規則由資料庫判斷。 */
export async function register(input: RegistrationInput): Promise<SubmitResult> {
  const supabase = await createClient();
  const result = await submitRegistration(supabase, sanitize(input));
  // 重新讀取頁面上的選項。已填的資料留在瀏覽器裡，不受影響。
  // 失敗時：她選的場地、支聯會、支會、午餐、午后動態已不能選，或課程、午餐、午后動態剛額滿、有變動，
  // 回到那一步時才會顯示最新的名單。
  // 成功時：課程可能剛被移到別的場次，完成頁才會用最新的場次顯示她的課。
  if (
    result.ok ||
    (["venue", "stake", "ward", "courses", "lunch", "afternoonActivity"] as const).some(
      (field) => result.errors[field],
    )
  ) {
    refresh();
  }
  return result;
}

// 任何人都能直接打這個動作，送來的不一定是報名表的形狀；型別不對的一律當成空白，交給欄位檢查擋下。
function sanitize(input: unknown): RegistrationInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  // 單選的午餐等：null 是「不需要」；其他不是字串的換成空字串，交給欄位檢查擋下。
  const choice = (key: string) => (raw[key] === null || raw[key] === undefined ? null : text(key));
  // 不是字串的項目換成空字串，交給欄位檢查擋下。
  const list = (key: string) =>
    Array.isArray(raw[key]) ? raw[key].map((item) => (typeof item === "string" ? item : "")) : [];
  return {
    name: text("name"),
    phone: text("phone"),
    noPhone: raw.noPhone === true,
    email: text("email"),
    lineId: text("lineId"),
    stakeId: text("stakeId"),
    wardId: text("wardId"),
    venueId: text("venueId"),
    courseIds: list("courseIds"),
    lunchOptionId: choice("lunchOptionId"),
    afternoonActivityId: choice("afternoonActivityId"),
    choirPart: choice("choirPart"),
    services: list("services"),
    printedHandbook: raw.printedHandbook === true,
    portraitConsent: raw.portraitConsent === true,
  };
}
