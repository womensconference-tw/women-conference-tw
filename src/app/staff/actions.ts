"use server";

import { redirect } from "next/navigation";
import { requestSignInLink } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";

/** 登入頁送出 Email：寄登入連結。不管 Email 有沒有帳號，畫面都一樣。 */
export async function sendSignInLink(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const result = await requestSignInLink(await createClient(), email);
  if (!result.ok) redirect(`/staff/login?error=${result.error}`);
  redirect("/staff/login?sent=1");
}

export async function signOut() {
  await (await createClient()).auth.signOut();
  redirect("/staff/login");
}
