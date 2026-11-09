"use server";

import { redirect } from "next/navigation";
import { saveConferenceDetails, saveSchedule, type ScheduleResult } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/server";

/*
 * 報名時間頁的儲存。是不是總管理員、時程對不對，都由資料庫判斷（src/lib/schedule.ts）。
 * 做完回到報名時間頁。
 */

export async function saveScheduleDetails(formData: FormData) {
  const field = fieldsOf(formData);
  const result = await saveConferenceDetails(await createClient(), {
    conferenceId: field("conferenceId"),
    conferenceDate: field("conferenceDate"),
    startTime: field("startTime"),
    endTime: field("endTime"),
  });
  done(result, "saved");
}

export async function saveScheduleTimes(formData: FormData) {
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

function fieldsOf(formData: FormData) {
  return (name: string) => String(formData.get(name) ?? "");
}

function done(result: ScheduleResult, success: string): never {
  redirect(result.ok ? `/staff/schedule?done=${success}` : `/staff/schedule?error=${result.error}`);
}
