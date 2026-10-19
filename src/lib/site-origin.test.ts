import { expect, it } from "vitest";
import { siteOrigin } from "./site-origin";

const origin = (headers: Record<string, string>) => siteOrigin(new Headers(headers));

it("用轉送標頭的網域與協定", () => {
  expect(origin({ "x-forwarded-host": "taiwanwomensconference.org", "x-forwarded-proto": "https", host: "internal:3000" })).toBe(
    "https://taiwanwomensconference.org",
  );
});

it("沒有轉送標頭時用 host；本機是 http，其他是 https", () => {
  expect(origin({ host: "localhost:3000" })).toBe("http://localhost:3000");
  expect(origin({ host: "127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
  expect(origin({ host: "example.vercel.app" })).toBe("https://example.vercel.app");
});

it("經過多層轉送、有好幾個值時取第一個", () => {
  expect(origin({ "x-forwarded-host": "a.example.org, b.example.org", "x-forwarded-proto": "https,http" })).toBe(
    "https://a.example.org",
  );
});

it("網域不是單純的主機名稱時不用，只給路徑：複製出去的網址不會指到別的網站（Codex 審查）", () => {
  for (const host of [
    "example.org@attacker.invalid",
    "attacker.invalid/x",
    "attacker.invalid?x",
    "attacker.invalid#x",
    "attacker.invalid\\x",
    "a b.org",
    "example.org:abc",
  ]) {
    expect(origin({ "x-forwarded-host": host, "x-forwarded-proto": "https" }), host).toBe("");
  }
});

it("協定不是 http 或 https 時不用", () => {
  expect(origin({ "x-forwarded-host": "example.org", "x-forwarded-proto": "javascript" })).toBe("");
});

it("讀不到網域時只給路徑", () => {
  expect(origin({})).toBe("");
});
