import type { Metadata } from "next";
import { STAFF_ROLE_LABELS } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "../current-staff";

export const metadata: Metadata = { title: "後台首頁" };

/** 後台首頁：顯示目前登入的角色與負責範圍。報名名單、統計等功能之後加在這裡。 */
export default async function StaffHomePage() {
  const supabase = await createClient();
  const staff = (await getCurrentStaff())!;
  const scope = staff.venueId
    ? (await supabase.from("venues").select("name_zh").eq("id", staff.venueId).maybeSingle()).data?.name_zh
    : staff.stakeId
      ? (await supabase.from("stakes").select("name_zh").eq("id", staff.stakeId).maybeSingle()).data?.name_zh
      : null;

  return (
    <main className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">台灣姐妹大會後台</h1>
      <p>
        你的角色是{STAFF_ROLE_LABELS[staff.role]}
        {scope && `，負責${scope}`}。
      </p>
    </main>
  );
}
