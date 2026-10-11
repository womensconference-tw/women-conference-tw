// 只用來解析路徑的假網站；導向目標解析後若不在這個網站上，就是會被帶去別的網站。
const SELF = "https://self.invalid";

/** 切換語言後要導回的站內路徑：只取來源網址的路徑與查詢字串，不會導去別的網站；取不到就回首頁。 */
export function returnPath(referer: string | null): string {
  if (!referer) return "/";
  try {
    const url = new URL(referer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";

    const path = url.pathname + url.search;
    // 瀏覽器會把 "//evil" 和 "/\evil" 當成別的網站。
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
    return new URL(path, SELF).origin === SELF ? path : "/";
  } catch {
    return "/";
  }
}
