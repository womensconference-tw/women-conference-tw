import { unstable_doesMiddlewareMatch, getRedirectUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { config, proxy } from "./proxy";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = inject("supabaseUrl");
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = inject("supabasePublishableKey");
});

describe("預覽首頁與預覽報名表", () => {
  it.each(["/preview", "/preview/register"])("沒登入的訪客打開 %s 被導到登入頁", async (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true);

    const response = await proxy(new NextRequest(`http://localhost${path}`));

    expect(getRedirectUrl(response)).toBe("http://localhost/staff/login");
  });

  it.each(["/", "/register", "/lookup"])("前台 %s 照常讓訪客打開", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(false);
  });
});
