"use server";

import { redirect } from "next/navigation";
import {
  deleteHomeItem,
  HOME_ITEM_KINDS,
  moveHomeItem,
  saveConferenceDetails,
  saveHighlightVenue,
  saveHomeItem,
  saveSchedule,
  type ContentResult,
  type HomeItemKind,
} from "@/lib/content";
import { attachHeroImage, HERO_SLOTS, removeHeroImage, saveHeroAlt, type HeroResult, type HeroSlot } from "@/lib/hero";
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
    welcomeSignatureZh: field("welcomeSignatureZh"),
    welcomeSignatureEn: field("welcomeSignatureEn"),
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
    summaryZh: field("summaryZh"),
    summaryEn: field("summaryEn"),
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

export async function saveHighlightVenueAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveHighlightVenue(await createClient(), {
    highlightId: field("highlightId"),
    venueId: field("venueId"),
    bodyZh: field("bodyZh"),
    bodyEn: field("bodyEn"),
  });
  done(result, "venueSaved");
}

/**
 * 瀏覽器把圖直接上傳到存放空間之後，呼叫這裡把路徑記到年度大會上（見 src/lib/hero.ts）。
 * 回傳結果而不是導向：記不成功時，瀏覽器要把剛上傳的檔案刪掉。
 */
export async function attachHeroImageAction(input: { conferenceId: string; slot: HeroSlot; path: string }): Promise<HeroResult> {
  return attachHeroImage(await createClient(), input);
}

export async function removeHeroImageAction(formData: FormData) {
  const field = fieldsOf(formData);
  const slot = field("slot");
  // 表單送來不認得的位置，只可能是有人改了網頁，直接當成錯誤。
  if (!(HERO_SLOTS as readonly string[]).includes(slot)) throw new Error(`不認得的主視覺位置：${slot}`);
  // 帶著畫面上那張圖的路徑：別人剛換成新圖時不會刪到新圖。
  const result = await removeHeroImage(await createClient(), {
    conferenceId: field("conferenceId"),
    slot: slot as HeroSlot,
    path: field("path"),
  });
  done(result, "heroRemoved");
}

export async function saveHeroAltAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveHeroAlt(await createClient(), {
    conferenceId: field("conferenceId"),
    altZh: field("heroAltZh"),
    altEn: field("heroAltEn"),
  });
  done(result, "saved");
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

function done(result: ContentResult | HeroResult | { ok: true; id: string }, success: string): never {
  redirect(result.ok ? `/staff/content?done=${success}` : `/staff/content?error=${result.error}`);
}
