import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

// 籌備委員會網站與大會特色介紹頁移到大會網站（#126、ADR 0012），舊網址一律轉到大會網站首頁。
describe("舊網址轉到大會網站", () => {
  it.each([PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER])("%s：/committee、/highlights 與底下的網址都轉過去", async (phase) => {
    const redirects = await nextConfig(phase).redirects!();

    expect(redirects).toEqual([
      { source: "/committee/:path*", destination: "https://www.taiwanwomensconference.org/", permanent: false },
      { source: "/highlights/:path*", destination: "https://www.taiwanwomensconference.org/", permanent: false },
    ]);
  });
});
