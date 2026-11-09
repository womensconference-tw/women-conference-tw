import "server-only";
import { after } from "next/server";
import { createResendSender, sendConfirmationEmail, type EmailKind } from "./confirmation-email";
import { confirmationSiteUrl } from "./site-url";
import { createServiceClient } from "./supabase/service";

/**
 * 回應送出之後才寄確認信（next/server 的 after），報名者不必等寄信；寄信成敗都不影響報名結果。
 * 信裡「查詢我的報名」的連結見 confirmationSiteUrl（./site-url）。
 * submissionKey 是新增、修改的送出編號：回應斷掉後重送同一次送出，信只寄一封。
 */
export function queueConfirmationEmail(registrationId: string, kind: EmailKind, submissionKey?: string) {
  const siteUrl = confirmationSiteUrl();
  after(async () => {
    try {
      await sendConfirmationEmail(
        createServiceClient(),
        registrationId,
        kind,
        createResendSender(),
        siteUrl,
        submissionKey,
      );
    } catch (error) {
      // sendConfirmationEmail 本身不丟出例外；這裡只會是沒設定 SUPABASE_SECRET_KEY。
      console.error("confirmation email not sent", error);
    }
  });
}

export { confirmationSiteUrl };
