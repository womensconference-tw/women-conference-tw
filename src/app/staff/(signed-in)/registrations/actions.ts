"use server";

import { redirect } from "next/navigation";
import { queueConfirmationEmail } from "@/lib/queue-confirmation-email";
import {
  changesOf,
  staffCancelRegistration,
  staffRegistrationInputFrom,
  staffSubmitRegistration,
  staffUpdateRegistration,
  type StaffSubmitResult,
} from "@/lib/registration";
import { describeFullOptions, getStatistics } from "@/lib/statistics";
import { createClient } from "@/lib/supabase/server";

/*
 * 後台新增、修改、取消報名（#17）。用登入的工作人員身分呼叫報名服務；
 * 是不是總管理員、名額、要不要確認超收都由資料庫判斷，這裡不另外檢查。成功後和前台一樣寄確認信。
 */

/** 結果；需要確認超收時多附額滿選項的說明（例如「課程「拼布」：名額 30 人，目前已報 30 人，加入後變成 31 人（超過名額 1 人）」）。 */
export type StaffFormResult = StaffSubmitResult & { fullOptions?: string[] };

/** 新增報名。confirmFull 是總管理員看過額滿提示、確定要超收。 */
export async function addRegistration(input: unknown, confirmFull: unknown): Promise<StaffFormResult> {
  const supabase = await createClient();
  const result = await staffSubmitRegistration(supabase, staffRegistrationInputFrom(input), {
    confirmFull: confirmFull === true,
  });
  if (result.ok) queueConfirmationEmail(result.registration.id, "registered");
  return withFullOptions(result);
}

/** 修改報名：哪一筆、修改後的內容（姓名、支聯會、支會、肖像權同意送來了也不用）。 */
export async function editRegistration(
  registrationId: unknown,
  input: unknown,
  confirmFull: unknown,
): Promise<StaffFormResult> {
  const supabase = await createClient();
  const staffInput = staffRegistrationInputFrom(input);
  const result = await staffUpdateRegistration(supabase, {
    registrationId: typeof registrationId === "string" ? registrationId : "",
    changes: { ...changesOf(staffInput), role: staffInput.role },
    confirmFull: confirmFull === true,
  });
  if (result.ok) queueConfirmationEmail(result.registration.id, "updated");
  return withFullOptions(result);
}

/** 取消報名，做完回到名單。 */
export async function cancelRegistrationByStaff(formData: FormData) {
  const registrationId = String(formData.get("registrationId") ?? "");
  const result = await staffCancelRegistration(await createClient(), registrationId);
  if (!result.ok) redirect(`/staff/registrations/${encodeURIComponent(registrationId)}?error=${result.error}`);
  // 已經取消的再按一次也成功；取消信只寄一次（見 begin_confirmation_email）。
  queueConfirmationEmail(registrationId, "cancelled");
  redirect("/staff/registrations?done=cancelled");
}

// 額滿選項的說明只是讓提示比較清楚；讀不到時照樣跳出提示，不讓總管理員卡在「系統出了問題」。
async function withFullOptions(result: StaffSubmitResult): Promise<StaffFormResult> {
  if (result.ok || !result.needsConfirmation) return result;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("conferences").select("id").eq("is_current", true).maybeSingle();
    if (error) throw error;
    if (!data) return result;
    return { ...result, fullOptions: describeFullOptions(await getStatistics(supabase, data.id), result.fullIds ?? []) };
  } catch (error) {
    console.error("讀不到額滿選項的人數", error);
    return result;
  }
}
