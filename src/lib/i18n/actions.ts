"use server";

import { cookies } from "next/headers";
import { localeCookie, parseLocale } from "./locale";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/** 記住語言選擇。由表單送出，送出後同一頁會用新語言重新顯示，不需要 JavaScript。 */
export async function switchLanguage(formData: FormData) {
  const locale = parseLocale(formData.get("locale")?.toString());
  const cookieStore = await cookies();
  cookieStore.set(localeCookie, locale, {
    path: "/",
    maxAge: ONE_YEAR_IN_SECONDS,
    sameSite: "lax",
  });
}
