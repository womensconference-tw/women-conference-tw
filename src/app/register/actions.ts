"use server";

import { refresh } from "next/cache";
import { getLocale } from "@/lib/i18n/server";
import { queueConfirmationEmail } from "@/lib/queue-confirmation-email";
import {
  fromOutdatedPage,
  OUTDATED_PAGE_RESULT,
  optionsMayHaveChanged,
  registrationInputFrom,
  submissionKeyOf,
  submitRegistration,
  type SubmitResult,
} from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/**
 * 報名表送出。用匿名訪客的身分呼叫報名服務；是否報名中等規則由資料庫判斷。
 * 報名語言是送出當下的畫面語言（語言 cookie）。成功後寄確認信。
 * submissionKey 是這次送出的送出編號：回應斷掉後重按沿用同一個，不會多一筆報名、多寄一封信。
 */
export async function register(input: unknown, submissionKey?: unknown): Promise<SubmitResult> {
  if (fromOutdatedPage(input)) return OUTDATED_PAGE_RESULT;
  const supabase = await createClient();
  const key = submissionKeyOf(submissionKey);
  const result = await submitRegistration(supabase, registrationInputFrom(input), await getLocale(), key);
  if (result.ok) queueConfirmationEmail(result.registration.id, "registered", key);
  if (optionsMayHaveChanged(result)) refresh();
  return result;
}
