/**
 * 確認信裡「查詢我的報名」連結用的網址；本機沒有這些變數，就是 undefined（信裡不附連結）。
 *
 * - 正式環境：用環境變數 SITE_URL（例如 https://register.taiwanwomensconference.org）。
 *   沒設時退回 Vercel 的 VERCEL_PROJECT_PRODUCTION_URL，但那是 Vercel 從專案的正式網域裡挑最短的一個，
 *   專案同時掛著別的網域（例如交接前的 www）時就不會是報名網站（#124）。
 * - 預覽環境：這次部署的網址（預覽連的是另一個資料庫，連到正式網站會查不到）。
 *
 * 不用請求的 Host 標頭組網址：任何人都能偽造它，再把別人的 Email 填進報名表，讓我們寄出假網站的連結。
 */
export function confirmationSiteUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.VERCEL_ENV === "production") {
    const siteUrl = env.SITE_URL?.trim().replace(/\/+$/, "");
    if (siteUrl) return siteUrl;
    return env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;
  }
  return env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined;
}
