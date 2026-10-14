"use server";

import { redirect } from "next/navigation";
import {
  addStaffMember,
  removeStaffMember,
  updateStaffMember,
  type StaffResult,
  type StaffRole,
  type StaffScope,
} from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentStaff } from "../../current-staff";

/*
 * 工作人員帳號的新增、修改、移除。是不是總管理員、範圍對不對、會不會沒有總管理員，都由資料庫函式判斷；
 * 建立與刪除登入帳號要用秘密金鑰（createServiceClient），在確認是總管理員之後才做。
 */

export async function addMember(formData: FormData) {
  const result = await addStaffMember(
    { session: await createClient(), authAdmin: createServiceClient() },
    { email: String(formData.get("email") ?? ""), ...scopeFrom(formData) },
  );
  done(result, "added");
}

export async function updateMember(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const scope = scopeFrom(formData);
  const me = await getCurrentStaff();
  const result = await updateStaffMember(await createClient(), { userId, ...scope });
  // 總管理員把自己改成承辦人員後，就看不到這一頁了，回後台首頁。
  if (result.ok && userId === me?.userId && scope.role !== "admin") redirect("/staff");
  done(result, "updated");
}

export async function removeMember(formData: FormData) {
  const result = await removeStaffMember(
    { session: await createClient(), authAdmin: createServiceClient() },
    String(formData.get("userId") ?? ""),
  );
  done(result, "removed");
}

// 表單同時有場地與支聯會兩個選單，只取角色用得到的那一個。不認得的角色照送，由資料庫擋下。
function scopeFrom(formData: FormData): StaffScope {
  const role = String(formData.get("role") ?? "") as StaffRole;
  const pick = (name: string) => String(formData.get(name) ?? "") || null;
  return {
    role,
    venueId: role === "venue_staff" ? pick("venueId") : null,
    stakeId: role === "stake_staff" ? pick("stakeId") : null,
  };
}

function done(result: StaffResult, success: string): never {
  redirect(result.ok ? `/staff/members?done=${success}` : `/staff/members?error=${result.error}`);
}
