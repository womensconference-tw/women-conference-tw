"use server";

import { redirect } from "next/navigation";
import {
  COMMITTEE_ITEM_KINDS,
  deleteCommitteeItem,
  discardCommitteeTextDraft,
  moveCommitteeLink,
  publishCommitteeTexts,
  saveCommitteeLink,
  saveCommitteeMember,
  saveCommitteeTextDraft,
  saveMeeting,
  saveTeamMember,
  type CommitteeItemKind,
  type CommitteeResult,
} from "@/lib/committee";
import { createClient } from "@/lib/supabase/server";

/*
 * 籌備委員會資訊的儲存、新增、排序、刪除。是不是總管理員由資料庫判斷（src/lib/committee.ts）。
 * 做完回到籌備委員會頁，停在原本選的年度。
 */

// 三個文字頁只存成草稿，預覽確定後才發布（#76）。
export async function saveTextDraftAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveCommitteeTextDraft(await createClient(), {
    conferenceId: field("conferenceId"),
    introduction: field("introduction"),
    chairMessage: field("chairMessage"),
    memorandum: field("memorandum"),
  });
  done(formData, result, "draft_saved");
}

// 從預覽頁發布，帶著預覽時看到的草稿版本代號。預覽之後草稿又被改過時，回到預覽頁看最新的草稿。
export async function publishTextsAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await publishCommitteeTexts(await createClient(), field("conferenceId"), field("revision"));
  done(formData, result, "published", result.ok || result.error !== "draft_changed" ? "/staff/committee" : "/preview/committee");
}

// 捨棄成功時帶一個新的重設代號，編輯框就算正在編輯也換回已發布的內容（RichTextEditor 的 resetToken）。
export async function discardTextDraftAction(formData: FormData) {
  const result = await discardCommitteeTextDraft(await createClient(), fieldsOf(formData)("conferenceId"));
  done(formData, result, "discarded", "/staff/committee", result.ok ? { reset: crypto.randomUUID() } : {});
}

export async function saveMeetingAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveMeeting(await createClient(), {
    id: field("id") || null,
    conferenceId: field("conferenceId"),
    title: field("title"),
    meetingDate: field("meetingDate"),
    url: field("url"),
    note: field("note"),
  });
  done(formData, result, "saved");
}

export async function saveLinkAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveCommitteeLink(await createClient(), {
    id: field("id") || null,
    conferenceId: field("conferenceId"),
    title: field("title"),
    url: field("url"),
  });
  done(formData, result, "saved");
}

export async function moveLinkAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await moveCommitteeLink(await createClient(), field("id"), field("direction") === "up" ? "up" : "down");
  done(formData, result, "moved");
}

export async function saveTeamMemberAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveTeamMember(await createClient(), {
    id: field("id") || null,
    conferenceId: field("conferenceId"),
    team: field("team"),
    role: field("role"),
    name: field("name"),
    region: field("region") || null,
    stakeId: field("stakeId"),
  });
  done(formData, result, "saved");
}

export async function saveMemberAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveCommitteeMember(await createClient(), {
    id: field("id") || null,
    conferenceId: field("conferenceId"),
    name: field("name"),
    stakeId: field("stakeId"),
    reliefSocietyPresidency: formData.get("reliefSocietyPresidency") === "on",
  });
  done(formData, result, "saved");
}

export async function deleteItemAction(formData: FormData) {
  const result = await deleteCommitteeItem(await createClient(), kindFrom(formData), fieldsOf(formData)("id"));
  done(formData, result, "deleted");
}

function fieldsOf(formData: FormData) {
  return (name: string) => String(formData.get(name) ?? "");
}

// 表單送來不認得的種類，只可能是有人改了網頁，直接當成錯誤。
function kindFrom(formData: FormData): CommitteeItemKind {
  const kind = String(formData.get("kind") ?? "");
  if (!(COMMITTEE_ITEM_KINDS as readonly string[]).includes(kind)) throw new Error(`不認得的項目種類：${kind}`);
  return kind as CommitteeItemKind;
}

function done(
  formData: FormData,
  result: CommitteeResult | { ok: true; id?: string; revision?: string },
  success: string,
  path = "/staff/committee",
  extra: Record<string, string> = {},
): never {
  const params = new URLSearchParams(extra);
  // 表單帶著目前看的年度，做完停在同一個年度。格式不對時（網頁被改過）回到預設的目前年度。
  const year = String(formData.get("year") ?? "");
  if (/^\d{4}$/.test(year)) params.set("year", year);
  if (result.ok) params.set("done", success);
  else params.set("error", result.error);
  redirect(`${path}?${params}`);
}
