import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getStaffMember } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";

/**
 * 登入信的連結（supabase/templates/magic_link.html）：用 token_hash 換成登入狀態，再進後台。
 * 用 token_hash 而不是 code，在別的裝置（例如電腦上要求、手機上打開）點連結也能登入。
 * 連結失效、或登入的人不在工作人員名單裡時，回登入頁說明。
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  if (!tokenHash || !type) return redirectTo(request, "/staff/login?error=link_invalid");
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return redirectTo(request, "/staff/login?error=link_invalid");

  if (!(await getStaffMember(supabase))) {
    await supabase.auth.signOut();
    return redirectTo(request, "/staff/login?error=not_staff");
  }
  return redirectTo(request, "/staff");
}

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}
