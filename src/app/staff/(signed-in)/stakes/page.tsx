import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { REGION_LABELS } from "@/lib/staff";
import { getStakeDirectory } from "@/lib/stakes";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../current-staff";
import { ResultMessage } from "../../result-message";
import { SubmitButton } from "../../submit-button";
import { TextPair } from "../../text-pair";
import { buttonClass } from "../../ui";
import { NumberFields } from "../programme/forms";
import { saveStakeItem } from "./actions";
import { DONE, ERRORS, InactiveBadge, nextPosition, RegionField } from "./forms";

export const metadata: Metadata = { title: "支聯會與支會" };

/** 支聯會與支會（只有總管理員）：支聯會列表，可新增支聯會，點進去編輯名稱、預設場地與支會。名單不屬於任何年度。 */
export default async function StakesPage({ searchParams }: PageProps<"/staff/stakes">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const { stakes } = await getStakeDirectory(await createClient());

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">支聯會與支會</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      <p className="rounded-lg border-2 border-card-outline p-3">
        教會重新劃分時，請停用舊的支會或支聯會、再新增新的，不要直接改名搬過去：舊報名會繼續顯示原本的支聯會與支會，統計和報報組看到的範圍才不會變。名稱打錯字可以直接修改。
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">支聯會（{stakes.length} 個）</h2>
        {stakes.length === 0 && <p>還沒有支聯會。</p>}
        <ul className="flex flex-col gap-3">
          {stakes.map((stake) => {
            const activeWards = stake.wards.filter((ward) => ward.isActive).length;
            return (
              <li key={stake.id}>
                <Link
                  href={`/staff/stakes/${stake.id}`}
                  className="flex flex-col gap-1 rounded-lg border-2 border-card-outline p-4 hover:bg-muted"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold underline">{stake.nameZh}</span>
                    {!stake.isActive && <InactiveBadge />}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {REGION_LABELS[stake.region]}・{activeWards} 個支會
                    {stake.wards.length > activeWards && `（另有 ${stake.wards.length - activeWards} 個已停用）`}・預設場地：
                    {stake.defaultSite?.nameZh ?? "未設定"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4">
        <h2 className="text-xl font-bold">新增支聯會</h2>
        <form action={saveStakeItem} className="flex flex-col gap-3">
          <TextPair name="name" label="名稱" required />
          <RegionField />
          <NumberFields position={nextPosition(stakes)} />
          <SubmitButton className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>新增支聯會</SubmitButton>
        </form>
      </section>
    </main>
  );
}
