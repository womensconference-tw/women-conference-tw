"use server";

import { redirect } from "next/navigation";
import {
  deleteAgendaItem,
  moveAgendaItem,
  saveAgendaItem,
  saveAgendaVenue,
  type AgendaResult,
} from "@/lib/agenda";
import { createClient } from "@/lib/supabase/server";

/*
 * 大會程序的新增、修改、排序、刪除與各場地的設定。是不是總管理員、場次對不對，都由資料庫判斷（src/lib/agenda.ts）。
 * 做完回到大會程序頁。
 */

export async function saveAgendaItemAction(formData: FormData) {
  const field = fieldsOf(formData);
  // 子項目每一列有中文、英文、大會特色三格，依表單上的順序。
  const all = (name: string) => formData.getAll(name).map(String);
  const [zh, en, highlights] = [all("partNameZh"), all("partNameEn"), all("partHighlightId")];
  const result = await saveAgendaItem(await createClient(), {
    id: field("id") || null,
    conferenceId: field("conferenceId"),
    startTime: field("startTime"),
    endTime: field("endTime"),
    nameZh: field("nameZh"),
    nameEn: field("nameEn"),
    parts: zh.map((nameZh, index) => ({ nameZh, nameEn: en[index] ?? "", highlightId: highlights[index] ?? "" })),
  });
  done(result, "saved");
}

export async function saveAgendaVenueAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveAgendaVenue(await createClient(), {
    agendaItemId: field("agendaItemId"),
    venueId: field("venueId"),
    placeZh: field("placeZh"),
    placeEn: field("placeEn"),
    noteZh: field("noteZh"),
    noteEn: field("noteEn"),
    sessionId: field("sessionId"),
    highlightId: field("highlightId"),
  });
  done(result, "saved");
}

export async function moveAgendaItemAction(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await moveAgendaItem(await createClient(), field("id"), field("direction") === "up" ? "up" : "down");
  done(result, "moved");
}

export async function deleteAgendaItemAction(formData: FormData) {
  const result = await deleteAgendaItem(await createClient(), fieldsOf(formData)("id"));
  done(result, "deleted");
}

function fieldsOf(formData: FormData) {
  return (name: string) => String(formData.get(name) ?? "");
}

function done(result: AgendaResult | { ok: true; id: string }, success: string): never {
  redirect(result.ok ? `/staff/agenda?done=${success}` : `/staff/agenda?error=${result.error}`);
}
