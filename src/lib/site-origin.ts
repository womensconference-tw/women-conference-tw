/**
 * 這次請求的網址開頭（https://網域），正式網域、預覽網址、本機都對。讀不到、或格式不對時是空字串，只給路徑。
 * 經過多層轉送時標頭可能有好幾個值（逗號隔開），取第一個。
 * 標頭可能被偽造（本機、或沒有清理轉送標頭的代理），網域只收單純的主機名稱與連接埠、協定只收 http(s)：
 * example.org@attacker.invalid 這種會指到別的網站的不收（Codex 審查）。
 */
export function siteOrigin(headers: Headers): string {
  const first = (name: string) => headers.get(name)?.split(",")[0].trim() || null;
  const host = first("x-forwarded-host") ?? first("host");
  if (!host || !/^[a-z0-9.-]+(:[0-9]{1,5})?$/i.test(host)) return "";
  const protocol = first("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  if (protocol !== "http" && protocol !== "https") return "";
  return `${protocol}://${host}`;
}
