"use server";

import { refresh } from "next/cache";
import {
  optionsMayHaveChanged,
  registrationInputFrom,
  submitRegistration,
  type SubmitResult,
} from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/** 報名表送出。用匿名訪客的身分呼叫報名服務；是否報名中等規則由資料庫判斷。 */
export async function register(input: unknown): Promise<SubmitResult> {
  const supabase = await createClient();
  const result = await submitRegistration(supabase, registrationInputFrom(input));
  if (optionsMayHaveChanged(result)) refresh();
  return result;
}
