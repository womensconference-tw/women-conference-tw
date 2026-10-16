"use server";

import { refresh } from "next/cache";
import { getLocale } from "@/lib/i18n/server";
import { queueConfirmationEmail } from "@/lib/queue-confirmation-email";
import {
  optionsMayHaveChanged,
  registrationInputFrom,
  submitRegistration,
  type SubmitResult,
} from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/**
 * 報名表送出。用匿名訪客的身分呼叫報名服務；是否報名中等規則由資料庫判斷。
 * 報名語言是送出當下的畫面語言（語言 cookie）。成功後寄確認信。
 */
export async function register(input: unknown): Promise<SubmitResult> {
  const supabase = await createClient();
  const result = await submitRegistration(supabase, registrationInputFrom(input), await getLocale());
  if (result.ok) queueConfirmationEmail(result.registration.id, "registered");
  if (optionsMayHaveChanged(result)) refresh();
  return result;
}
