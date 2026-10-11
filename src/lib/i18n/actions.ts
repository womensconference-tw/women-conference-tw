"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { localeCookie, parseLocale } from "./locale";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/**
 * 記住語言選擇，再導回原本那一頁，讓沒有 JavaScript 時最後顯示的也是一般頁面，
 * 按重新整理不會被問要不要重送表單。
 */
export async function switchLanguage(formData: FormData) {
  const locale = parseLocale(formData.get("locale")?.toString());
  const cookieStore = await cookies();
  cookieStore.set(localeCookie, locale, {
    path: "/",
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: "lax",
  });

  const headerStore = await headers();
  redirect(sameSitePath(headerStore.get("referer")));
}

/** 只取來源網址的路徑與查詢字串，不會導去別的網站；取不到就回首頁。 */
function sameSitePath(referer: string | null): string {
  if (!referer) return "/";
  try {
    const url = new URL(referer);
    const path = url.pathname + url.search;
    // "//example.com" 會被當成別的網站。
    return path.startsWith("/") && !path.startsWith("//") ? path : "/";
  } catch {
    return "/";
  }
}
