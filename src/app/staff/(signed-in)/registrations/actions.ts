"use server";

import { redirect } from "next/navigation";
import { createResendSender } from "@/lib/confirmation-email";
import { resendConfirmationEmail, type ResendResult } from "@/lib/email-logs";
import { confirmationSiteUrl, queueConfirmationEmail } from "@/lib/queue-confirmation-email";
import {
  changesOf,
  staffCancelRegistration,
  staffRegistrationInputFrom,
  staffSubmitRegistration,
  staffUpdateRegistration,
  submissionKeyOf,
  type StaffSubmitResult,
} from "@/lib/registration";
import { getRegistrationForEdit } from "@/lib/registration-list";
import { describeFullOptions, getStatistics } from "@/lib/statistics";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/*
 * 後台新增、修改、取消報名（#17）。用登入的工作人員身分呼叫報名服務；
 * 是不是總管理員、名額、要不要確認超收都由資料庫判斷，這裡不另外檢查。成功後和前台一樣寄確認信。
 */

/** 結果；需要確認超收時多附額滿選項的說明（例如「課程「拼布」：名額 30 人，目前已報 30 人，加入後變成 31 人（超過名額 1 人）」）。 */
export type StaffFormResult = StaffSubmitResult & { fullOptions?: string[] };

/**
 * 新增報名。confirmFull 是總管理員看過額滿提示、確定要超收。
 * submissionKey 是這次送出的送出編號：回應斷掉後重按沿用同一個，不會多一筆報名、多寄一封信。
 */
export async function addRegistration(
  input: unknown,
  confirmFull: unknown,
  submissionKey?: unknown,
): Promise<StaffFormResult> {
  const supabase = await createClient();
  const key = submissionKeyOf(submissionKey);
  const result = await staffSubmitRegistration(supabase, staffRegistrationInputFrom(input), {
    confirmFull: confirmFull === true,
    submissionKey: key,
  });
  if (result.ok) queueConfirmationEmail(result.registration.id, "registered", key);
  return withFullOptions(result);
}

/** 修改報名：哪一筆、修改後的內容（姓名、支聯會、支會、肖像權同意送來了也不用）。送出編號同新增。 */
export async function editRegistration(
  registrationId: unknown,
  input: unknown,
  confirmFull: unknown,
  submissionKey?: unknown,
): Promise<StaffFormResult> {
  const supabase = await createClient();
  const staffInput = staffRegistrationInputFrom(input);
  const key = submissionKeyOf(submissionKey);
  const result = await staffUpdateRegistration(supabase, {
    registrationId: typeof registrationId === "string" ? registrationId : "",
    changes: { ...changesOf(staffInput), role: staffInput.role },
    confirmFull: confirmFull === true,
    submissionKey: key,
  });
  if (result.ok) queueConfirmationEmail(result.registration.id, "updated", key);
  return withFullOptions(result, typeof registrationId === "string" ? registrationId : undefined);
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

/**
 * 重寄確認信（#18），做完回到同一頁顯示結果。是不是總管理員、讀不讀得到這筆報名由 resendConfirmationEmail 用她的登入身分確認。
 * 等寄完才回應，按鈕在這段時間顯示寄送中。
 */
export async function resendConfirmation(formData: FormData) {
  const registrationId = String(formData.get("registrationId") ?? "");
  let result: ResendResult | { ok: false; error: "unknown" };
  try {
    result = await resendConfirmationEmail(
      await createClient(),
      createServiceClient(),
      registrationId,
      createResendSender(),
      confirmationSiteUrl(),
    );
  } catch (error) {
    // 寄信本身不丟出例外；這裡是讀報名時資料庫出錯，或沒設定 SUPABASE_SECRET_KEY。只記錯誤代碼，不記可能含個資的內容。
    console.error("resend confirmation email failed", { registrationId, name: (error as Error)?.name });
    result = { ok: false, error: "unknown" };
  }
  const page = `/staff/registrations/${encodeURIComponent(registrationId)}`;
  redirect(result.ok ? `${page}?done=resent` : `${page}?error=resend_${result.error}`);
}

// 額滿選項的說明只是讓提示比較清楚；讀不到時照樣跳出提示，不讓總管理員卡在「系統出了問題」。
// 修改時傳入 registrationId：她原本已佔的選項不列出（見 describeFullOptions）。修改被拒時報名沒變，讀到的是原本的。
async function withFullOptions(result: StaffSubmitResult, registrationId?: string): Promise<StaffFormResult> {
  if (result.ok || !result.needsConfirmation) return result;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("conferences").select("id").eq("is_current", true).maybeSingle();
    if (error) throw error;
    if (!data) return result;
    const registration = registrationId ? await getRegistrationForEdit(supabase, registrationId) : null;
    const heldIds = registration
      ? [...registration.courseIds, registration.lunchOptionId, registration.afternoonActivityId].filter(
          (id): id is string => id !== null,
        )
      : [];
    const statistics = await getStatistics(supabase, data.id);
    return { ...result, fullOptions: describeFullOptions(statistics, result.fullIds ?? [], heldIds) };
  } catch (error) {
    console.error("讀不到額滿選項的人數", error);
    return result;
  }
}
