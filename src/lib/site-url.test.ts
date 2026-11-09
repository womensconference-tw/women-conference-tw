import { describe, expect, it } from "vitest";
import { confirmationSiteUrl } from "./site-url";

describe("confirmationSiteUrl", () => {
  const production = {
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "taiwanwomensconference.org",
    VERCEL_URL: "women-conference-abc123.vercel.app",
  };

  it("uses SITE_URL in production, not the domain Vercel picks", () => {
    expect(confirmationSiteUrl({ ...production, SITE_URL: "https://register.taiwanwomensconference.org" })).toBe(
      "https://register.taiwanwomensconference.org",
    );
  });

  it("drops a trailing slash and spaces from SITE_URL", () => {
    expect(confirmationSiteUrl({ ...production, SITE_URL: " https://register.taiwanwomensconference.org/ " })).toBe(
      "https://register.taiwanwomensconference.org",
    );
  });

  it("falls back to Vercel's production domain when SITE_URL is not set", () => {
    expect(confirmationSiteUrl(production)).toBe("https://taiwanwomensconference.org");
    expect(confirmationSiteUrl({ ...production, SITE_URL: "" })).toBe("https://taiwanwomensconference.org");
  });

  it("uses this deployment's URL on previews, even when SITE_URL is set", () => {
    expect(
      confirmationSiteUrl({
        ...production,
        VERCEL_ENV: "preview",
        SITE_URL: "https://register.taiwanwomensconference.org",
      }),
    ).toBe("https://women-conference-abc123.vercel.app");
  });

  it("has no link locally", () => {
    expect(confirmationSiteUrl({})).toBeUndefined();
  });
});
