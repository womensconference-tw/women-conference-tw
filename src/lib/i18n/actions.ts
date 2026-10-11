"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { localeCookie, parseLocale } from "./locale";
import { returnPath } from "./return-path";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/**
 * 記住語言選擇。
 * - 有 JavaScript：同一頁直接用新語言重新顯示，頁面上已填的內容不會被清掉。
 * - 沒有 JavaScript：導回原本那一頁，最後顯示的是一般頁面，按重新整理不會被問要不要重送表單。
 */
export async function switchLanguage(formData: FormData) {
  const locale = parseLocale(formData.get("locale")?.toString());
  const cookieStore = await cookies();
  cookieStore.set(localeCookie, locale, {
    path: "/",
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: "lax",
  });

  if (formData.get("enhanced") === "1") return;
  const headerStore = await headers();
  redirect(returnPath(headerStore.get("referer")));
}
