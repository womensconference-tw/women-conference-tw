import { cookies } from "next/headers";
import { cache } from "react";
import { localeCookie, parseLocale, type Locale } from "./locale";
import { messages, type Messages } from "./messages";

/** 這次請求要用的語言，依 cookie 決定；沒選過就是中文。同一次請求只讀一次。 */
export const getLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();
  return parseLocale(cookieStore.get(localeCookie)?.value);
});

/** 這次請求語言的介面文字。 */
export async function getMessages(): Promise<Messages> {
  return messages[await getLocale()];
}
