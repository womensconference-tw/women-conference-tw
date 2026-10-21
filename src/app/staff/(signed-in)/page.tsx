import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { REGION_LABELS, STAFF_ROLE_LABELS } from "@/lib/staff";
import { CopyUrl } from "../copy-url";
import { getCurrentStaff } from "../current-staff";

export const metadata: Metadata = { title: "後台首頁" };

/** 後台首頁：顯示目前登入的角色與負責範圍。 */
export default async function StaffHomePage() {
  const staff = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!staff) redirect("/staff/login");
  const scope = staff.region ? REGION_LABELS[staff.region] : staff.role === "admin" ? null : "全區";

  return (
    <main className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">台灣姐妹大會後台</h1>
      <p>
        {staff.name && `${staff.name}，`}你的角色是{STAFF_ROLE_LABELS[staff.role]}
        {scope && `，負責${scope}`}。
      </p>
      <section className="mt-4 flex flex-col gap-2">
        <h2 className="text-xl font-bold">分享首頁到 LINE 群組</h2>
        <p>貼到支會 LINE 群組請用這個網址，姐妹點開時會改用手機的瀏覽器，報名比較順。</p>
        <CopyUrl path="/" />
      </section>
    </main>
  );
}
