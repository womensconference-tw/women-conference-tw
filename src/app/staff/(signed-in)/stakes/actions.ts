"use server";

import { redirect } from "next/navigation";
import { deleteUnit, saveStake, saveWard, setUnitActive, type StakeResult, type UnitKind } from "@/lib/stakes";
import { UUID_PATTERN } from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/*
 * 支聯會與支會的新增、修改、停用、刪除。是不是總管理員、有沒有報名，都由資料庫判斷（src/lib/stakes.ts）。
 * 做完回到同一個支聯會的編輯頁；刪掉支聯會時回到列表。
 */

export async function saveStakeItem(formData: FormData) {
  const field = fieldsOf(formData);
  const id = field("id") || undefined;
  const result = await saveStake(await createClient(), {
    id,
    nameZh: field("nameZh"),
    nameEn: field("nameEn"),
    region: field("region"),
    position: field("position"),
  });
  // 新增支聯會後直接到它的編輯頁，接著加支會。
  done(result, "saved", id ?? (result.ok ? result.id : ""));
}

export async function saveWardItem(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveWard(await createClient(), {
    id: field("id") || undefined,
    stakeId: field("id") ? undefined : field("stakeId"),
    nameZh: field("nameZh"),
    nameEn: field("nameEn"),
    position: field("position"),
  });
  done(result, "saved", field("stakeId"));
}

export async function setUnitActiveItem(formData: FormData) {
  const field = fieldsOf(formData);
  const active = field("active") === "true";
  const result = await setUnitActive(await createClient(), kindFrom(formData), field("id"), active);
  done(result, active ? "activated" : "deactivated", field("stakeId"));
}

export async function deleteUnitItem(formData: FormData) {
  const field = fieldsOf(formData);
  const kind = kindFrom(formData);
  const result = await deleteUnit(await createClient(), kind, field("id"));
  done(result, "deleted", kind === "stake" && result.ok ? "" : field("stakeId"));
}

function fieldsOf(formData: FormData) {
  return (name: string) => String(formData.get(name) ?? "");
}

// 不認得的種類當成支會；編號對不到時由資料庫回報找不到。
function kindFrom(formData: FormData): UnitKind {
  return formData.get("kind") === "stake" ? "stake" : "ward";
}

function done(result: StakeResult | { ok: true; id: string }, success: string, stakeId: string): never {
  const page = UUID_PATTERN.test(stakeId) ? `/staff/stakes/${stakeId}` : "/staff/stakes";
  redirect(result.ok ? `${page}?done=${success}` : `${page}?error=${result.error}`);
}
