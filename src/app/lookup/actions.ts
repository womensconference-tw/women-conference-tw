"use server";

import { refresh } from "next/cache";
import { getLocale } from "@/lib/i18n/server";
import {
  cancelRegistration,
  changesOf,
  lookupRegistration,
  optionsMayHaveChanged,
  registrationInputFrom,
  updateRegistration,
  type CancelResult,
  type LookupResult,
  type SubmitResult,
} from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/** 查詢表單送出。用匿名訪客的身分呼叫報名服務；比對由資料庫函式負責。 */
export async function lookUp(input: unknown): Promise<LookupResult> {
  const supabase = await createClient();
  return lookupRegistration(supabase, lookupInputFrom(input), await getLocale());
}

/**
 * 修改報名送出：哪一筆、查詢時用的姓名與電話（或報名編號），以及修改後的報名表內容。
 * 用匿名訪客的身分呼叫報名服務；是否報名中、姓名與電話是否符合、名額等由資料庫判斷。
 */
export async function updateMine(input: unknown): Promise<SubmitResult> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const supabase = await createClient();
  const result = await updateRegistration(supabase, {
    registrationId: typeof raw.registrationId === "string" ? raw.registrationId : "",
    lookup: lookupInputFrom(raw.lookup),
    // 姓名、支聯會、支會、肖像權同意不能改，送來了也不用。
    changes: changesOf(registrationInputFrom(raw.changes)),
  });
  if (optionsMayHaveChanged(result)) refresh();
  return result;
}

/**
 * 取消報名送出：哪一筆，以及查詢時用的姓名與電話（或報名編號）。
 * 用匿名訪客的身分呼叫報名服務；是否報名中、姓名與電話是否符合由資料庫判斷。
 */
export async function cancelMine(input: unknown): Promise<CancelResult> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const supabase = await createClient();
  const result = await cancelRegistration(supabase, {
    registrationId: typeof raw.registrationId === "string" ? raw.registrationId : "",
    lookup: lookupInputFrom(raw.lookup),
  });
  // 名額釋出了，報名表上「已額滿」的標示要重新讀取。
  if (result.ok) refresh();
  return result;
}

// 任何人都能直接打這些動作，送來的不一定是表單的形狀；不是字串的當成空白，交給欄位檢查擋下。
function lookupInputFrom(input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  return { name: text("name"), phoneOrNumber: text("phoneOrNumber") };
}
