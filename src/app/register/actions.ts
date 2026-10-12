"use server";

import { submitRegistration, type RegistrationInput, type SubmitResult } from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/** 報名表送出。用匿名訪客的身分呼叫報名服務；是否報名中等規則由資料庫判斷。 */
export async function register(input: RegistrationInput): Promise<SubmitResult> {
  const supabase = await createClient();
  return submitRegistration(supabase, sanitize(input));
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
    portraitConsent: raw.portraitConsent === true,
  };
}
