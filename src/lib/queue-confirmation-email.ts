import "server-only";
import { after } from "next/server";
import { createResendSender, sendConfirmationEmail, type EmailKind } from "./confirmation-email";
import { createServiceClient } from "./supabase/service";

/**
 * 回應送出之後才寄確認信（next/server 的 after），報名者不必等寄信；寄信成敗都不影響報名結果。
 * 信裡「查詢我的報名」的連結用 Vercel 提供的網址：正式環境是正式網址，預覽環境是這次部署的網址
 * （預覽連的是另一個資料庫，連到正式網站會查不到）；本機沒有這些變數，就不附連結。
 * 不用請求的 Host 標頭組網址：任何人都能偽造它，再把別人的 Email 填進報名表，讓我們寄出假網站的連結。
 */
export function queueConfirmationEmail(registrationId: string, kind: EmailKind) {
  const host =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL;
  after(async () => {
    try {
      await sendConfirmationEmail(
        createServiceClient(),
        registrationId,
        kind,
        createResendSender(),
        host ? `https://${host}` : undefined,
      );
    } catch (error) {
      // sendConfirmationEmail 本身不丟出例外；這裡只會是沒設定 SUPABASE_SECRET_KEY。
      console.error("confirmation email not sent", error);
    }
  });
}
