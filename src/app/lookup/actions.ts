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
import { createServiceClient } from "@/lib/supabase/service";

/*
 * 查詢、修改、取消都用網站伺服器的身分（createServiceClient）呼叫報名服務：
 * 這些資料庫函式不開放訪客直接呼叫（ADR 0009）。比對、猜錯次數、名額仍由資料庫函式負責。
 */

/** 查詢表單送出。比對由資料庫函式負責。 */
export async function lookUp(input: unknown): Promise<LookupResult> {
  return lookupRegistration(createServiceClient(), lookupInputFrom(input), await getLocale());
}

/**
 * 修改報名送出：哪一筆、查詢時用的姓名與電話（或報名編號），以及修改後的報名表內容。
 * 是否報名中、姓名與電話是否符合、名額等由資料庫判斷。
 */
export async function updateMine(input: unknown): Promise<SubmitResult> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const result = await updateRegistration(createServiceClient(), {
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
 * 是否報名中、姓名與電話是否符合由資料庫判斷。
 */
export async function cancelMine(input: unknown): Promise<CancelResult> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const result = await cancelRegistration(createServiceClient(), {
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
