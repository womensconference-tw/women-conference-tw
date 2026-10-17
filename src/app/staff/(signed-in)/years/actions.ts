"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { copyConference, setCurrentConference } from "@/lib/years";

/*
 * 複製年度、切換目前年度。是不是總管理員、時程對不對，都由資料庫判斷（src/lib/years.ts）。
 * 做完回到年度管理頁。
 */

export async function copyYear(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await copyConference(await createClient(), {
    sourceConferenceId: field("sourceConferenceId"),
    year: field("year"),
    conferenceDate: field("conferenceDate"),
  });
  if (!result.ok) redirect(`/staff/years?error=${result.error}`);
  redirect(`/staff/years?done=${result.skippedCoursePairs > 0 ? "copied_without_some_pairs" : "copied"}`);
}

export async function makeCurrentYear(formData: FormData) {
  const field = fieldsOf(formData);
  // 時程已填好的年度，表單不送這幾欄。
  const optional = (name: string) => (formData.has(name) ? field(name) : undefined);
  const result = await setCurrentConference(await createClient(), {
    conferenceId: field("conferenceId"),
    announceAt: optional("announceAt"),
    registrationOpensAt: optional("registrationOpensAt"),
    registrationClosesAt: optional("registrationClosesAt"),
  });
  redirect(result.ok ? "/staff/years?done=switched" : `/staff/years?error=${result.error}`);
}

function fieldsOf(formData: FormData) {
  return (name: string) => String(formData.get(name) ?? "");
}
