import { describe, expect, it } from "vitest";
import { returnPath } from "./return-path";

describe("切換語言後導回的網址", () => {
  it("導回原本那一頁，保留查詢字串", () => {
    expect(returnPath("https://example.tw/register?step=2")).toBe("/register?step=2");
  });

  it("沒有來源網址時回首頁", () => {
    expect(returnPath(null)).toBe("/");
  });

  // 每一種都可能被瀏覽器解讀成別的網站，一律回首頁。
  it.each([
    { trick: "路徑開頭是 //", referer: "https://example.tw//evil.example/x" },
    { trick: "路徑開頭是 /\\", referer: "custom:/\\evil.example/path" },
    { trick: "非 http(s) 網址", referer: "custom:/path" },
    { trick: "javascript: 網址", referer: "javascript:alert(1)" },
    { trick: "看不懂的字串", referer: "not a url" },
  ])("$trick時回首頁", ({ referer }) => {
    expect(returnPath(referer)).toBe("/");
  });
});
