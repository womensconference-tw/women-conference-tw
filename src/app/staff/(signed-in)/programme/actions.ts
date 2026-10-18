"use server";

import { redirect } from "next/navigation";
import {
  addCoursePair,
  deleteItem,
  ITEM_KINDS,
  removeCoursePair,
  saveItem,
  setRegistrationStopped,
  STOPPABLE_KINDS,
  type ItemKind,
  type ProgrammeResult,
} from "@/lib/programme";
import { UUID_PATTERN } from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";

/*
 * 課程安排的新增、修改、刪除。是不是總管理員、報名開放了沒、有沒有人選過，都由資料庫判斷（src/lib/programme.ts）。
 * 做完回到同一個場地的編輯頁；刪掉場地時回到場地列表。
 */

export async function saveProgrammeItem(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await saveItem(await createClient(), {
    kind: kindFrom(formData),
    id: field("id") || null,
    conferenceId: field("conferenceId"),
    parentId: field("parentId") || null,
    position: field("position"),
    nameZh: field("nameZh"),
    nameEn: field("nameEn"),
    descriptionZh: field("descriptionZh"),
    descriptionEn: field("descriptionEn"),
    region: field("region"),
    addressZh: field("addressZh"),
    addressEn: field("addressEn"),
    featuresZh: field("featuresZh"),
    featuresEn: field("featuresEn"),
    capacity: field("capacity"),
    classroom: field("classroom"),
  });
  // 新增場地後直接到它的編輯頁，接著加場次、課程。
  const venueId = field("venueId") || (result.ok && kindFrom(formData) === "venue" ? result.id : "");
  done(result, "saved", venueId);
}

export async function deleteProgrammeItem(formData: FormData) {
  const kind = kindFrom(formData);
  const result = await deleteItem(await createClient(), kind, String(formData.get("id") ?? ""));
  const venueId = kind === "venue" && result.ok ? "" : String(formData.get("venueId") ?? "");
  done(result, "deleted", venueId);
}

export async function addProgrammeCoursePair(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await addCoursePair(
    await createClient(),
    field("conferenceId"),
    field("firstCourseId"),
    field("secondCourseId"),
  );
  done(result, "paired", field("venueId"));
}

export async function removeProgrammeCoursePair(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await removeCoursePair(await createClient(), field("firstCourseId"));
  done(result, "unpaired", field("venueId"));
}

/** 停止或重新開放一個課程、午餐的報名；成對課程兩堂一起。 */
export async function setProgrammeStopped(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  const kind = STOPPABLE_KINDS.find((candidate) => candidate === field("kind"));
  // 表單送來不認得的種類，只可能是有人改了網頁，直接當成錯誤。
  if (!kind) throw new Error(`不能停止報名的項目：${field("kind")}`);
  const stopped = field("stopped") === "true";
  const result = await setRegistrationStopped(await createClient(), kind, field("id"), stopped);
  done(result, stopped ? "stopped" : "reopened", field("venueId"));
}

// 表單送來不認得的種類，只可能是有人改了網頁，直接當成錯誤。
function kindFrom(formData: FormData): ItemKind {
  const kind = String(formData.get("kind") ?? "");
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) throw new Error(`不認得的項目種類：${kind}`);
  return kind as ItemKind;
}

function done(result: ProgrammeResult, success: string, venueId: string): never {
  const page = UUID_PATTERN.test(venueId) ? `/staff/programme/${venueId}` : "/staff/programme";
  redirect(result.ok ? `${page}?done=${success}` : `${page}?error=${result.error}`);
}
