"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { normalizeEmail, requestSignInLink } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";

/**
 * 登入頁送出 Email：寄登入連結。不管 Email 有沒有帳號，畫面都一樣。
 * 回應送出後才寄（after），回應時間才不會因為有帳號、要寄信而變長，讓人從快慢猜出誰是工作人員。
 * 寄信失敗只能記下來，畫面上已經顯示寄出了。
 */
export async function sendSignInLink(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  if (!normalizeEmail(email)) redirect("/staff/login?error=email_invalid");

  // 登入信用 token_hash，不需要這個瀏覽器的 cookie，所以用不帶 cookie 的連線，可以在回應之後使用。
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  after(() => requestSignInLink(supabase, email));
  redirect("/staff/login?sent=1");
}

export async function signOut() {
  await (await createClient()).auth.signOut();
  redirect("/staff/login");
}
