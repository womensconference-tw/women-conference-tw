import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getRegistrationOptions } from "@/lib/registration-options";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "../../../current-staff";
import { RegistrationEditor } from "../registration-editor";

export const metadata: Metadata = { title: "新增報名" };

/** 後台新增報名（只有總管理員）：目前年度，不受報名期間限制。 */
export default async function NewRegistrationPage() {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const options = await getRegistrationOptions(await createClient(), "zh");

  return (
    <main className="flex flex-col gap-6">
      <Link href="/staff/registrations" className="font-semibold underline">
        ← 回到報名名單
      </Link>
      <h1 className="text-2xl font-bold">新增報名</h1>
      {options.venues.length === 0 ? (
        <p>目前年度還沒有場地，請先到「場地與課程」新增。</p>
      ) : (
        <RegistrationEditor options={options} />
      )}
    </main>
  );
}
