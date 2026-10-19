import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 不用登入就能打開的後台頁面：登入頁，以及登入信連結的確認頁。
const SIGNED_OUT_PATHS = ["/staff/login", "/staff/auth/confirm"];

/**
 * 後台 /staff 與預覽頁 /preview 的每個請求：更新登入狀態的 cookie，沒登入就導回登入頁，並告訴搜尋引擎不要收錄。
 * 這裡只看有沒有登入；是不是工作人員、能看什麼，由後台頁面與資料庫的權限規則判斷（ADR 0004）。
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // 驗證登入憑證，快過期時順便換新（新的 cookie 由上面的 setAll 寫進 response）。
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && !SIGNED_OUT_PATHS.includes(request.nextUrl.pathname)) {
    const redirect = NextResponse.redirect(new URL("/staff/login", request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    response = redirect;
  }

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/staff/:path*", "/preview/:path*"],
};
