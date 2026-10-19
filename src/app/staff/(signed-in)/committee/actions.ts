"use server";

import { redirect } from "next/navigation";
import {
  COMMITTEE_ITEM_KINDS,
  deleteCommitteeItem,
  moveCommitteeLink,
  saveCommitteeLink,
  saveCommitteeMember,
  saveCommitteeTexts,
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

export async function saveTextsAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveCommitteeTexts(await createClient(), {
    conferenceId: field("conferenceId"),
    introduction: field("introduction"),
    chairMessage: field("chairMessage"),
    memorandum: field("memorandum"),
  });
  done(formData, result, "saved");
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

function done(formData: FormData, result: CommitteeResult | { ok: true; id: string }, success: string): never {
  const params = new URLSearchParams();
  // 表單帶著目前看的年度，做完停在同一個年度。格式不對時（網頁被改過）回到預設的目前年度。
  const year = String(formData.get("year") ?? "");
  if (/^\d{4}$/.test(year)) params.set("year", year);
  if (result.ok) params.set("done", success);
  else params.set("error", result.error);
  redirect(`/staff/committee?${params}`);
}
