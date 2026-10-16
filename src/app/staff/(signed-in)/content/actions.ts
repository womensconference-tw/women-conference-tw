"use server";

import { redirect } from "next/navigation";
import {
  deleteHomeItem,
  HOME_ITEM_KINDS,
  moveHomeItem,
  saveConferenceDetails,
  saveHomeItem,
  saveSchedule,
  type ContentResult,
  type HomeItemKind,
} from "@/lib/content";
import { createClient } from "@/lib/supabase/server";

/*
 * 首頁內容的儲存、新增、排序、刪除。是不是總管理員、時程對不對，都由資料庫判斷（src/lib/content.ts）。
 * 做完回到首頁內容頁。
 */

export async function saveContentDetails(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveConferenceDetails(await createClient(), {
    conferenceId: field("conferenceId"),
    conferenceDate: field("conferenceDate"),
    startTime: field("startTime"),
    endTime: field("endTime"),
    themeScriptureZh: field("themeScriptureZh"),
    themeScriptureEn: field("themeScriptureEn"),
    themeScriptureReferenceZh: field("themeScriptureReferenceZh"),
    themeScriptureReferenceEn: field("themeScriptureReferenceEn"),
    welcomeZh: field("welcomeZh"),
    welcomeEn: field("welcomeEn"),
    adminLineId: field("adminLineId"),
  });
  done(result, "saved");
}

export async function saveContentSchedule(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveSchedule(await createClient(), {
    conferenceId: field("conferenceId"),
    announceAt: field("announceAt"),
    // 報名開放後表單不送這一欄（不能再改）。
    registrationOpensAt: formData.has("registrationOpensAt") ? field("registrationOpensAt") : undefined,
    registrationClosesAt: field("registrationClosesAt"),
  });
  done(result, "scheduled");
}

export async function saveContentItem(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveHomeItem(await createClient(), {
    kind: kindFrom(formData),
    id: field("id") || null,
    conferenceId: field("conferenceId"),
    titleZh: field("titleZh"),
    titleEn: field("titleEn"),
    bodyZh: field("bodyZh"),
    bodyEn: field("bodyEn"),
    buttonLabelZh: field("buttonLabelZh"),
    buttonLabelEn: field("buttonLabelEn"),
    buttonUrl: field("buttonUrl"),
  });
  done(result, "saved");
}

export async function deleteContentItem(formData: FormData) {
  const result = await deleteHomeItem(await createClient(), kindFrom(formData), fieldsOf(formData)("id"));
  done(result, "deleted");
}

export async function moveContentItem(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await moveHomeItem(
    await createClient(),
    kindFrom(formData),
    field("id"),
    field("direction") === "up" ? "up" : "down",
  );
  done(result, "moved");
}

function fieldsOf(formData: FormData) {
  return (name: string) => String(formData.get(name) ?? "");
}

// 表單送來不認得的種類，只可能是有人改了網頁，直接當成錯誤。
function kindFrom(formData: FormData): HomeItemKind {
  const kind = String(formData.get("kind") ?? "");
  if (!(HOME_ITEM_KINDS as readonly string[]).includes(kind)) throw new Error(`不認得的項目種類：${kind}`);
  return kind as HomeItemKind;
}

function done(result: ContentResult | { ok: true; id: string }, success: string): never {
  redirect(result.ok ? `/staff/content?done=${success}` : `/staff/content?error=${result.error}`);
}
