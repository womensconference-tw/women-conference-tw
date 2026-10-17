import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { UUID_PATTERN } from "@/lib/registration";
import { REGION_LABELS } from "@/lib/staff";
import { getStakeDirectory } from "@/lib/stakes";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getCurrentStaff } from "../../../current-staff";
import { ResultMessage } from "../../../result-message";
import { SubmitButton } from "../../../submit-button";
import { TextPair } from "../../../text-pair";
import { buttonClass } from "../../../ui";
import { NumberFields } from "../../programme/forms";
import { saveStakeItem, saveWardItem } from "../actions";
import { ActiveToggle, DeleteUnit, DONE, ERRORS, InactiveBadge, nextPosition, SiteField } from "../forms";

export const metadata: Metadata = { title: "編輯支聯會" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";

/**
 * 編輯一個支聯會（只有總管理員）：名稱、排序、預設場地、停用；它的支會的新增、修改、停用、刪除。
 * 支會不能換到別的支聯會；重新劃分時停用舊支會、在新的支聯會新增。
 */
export default async function StakePage({ params, searchParams }: PageProps<"/staff/stakes/[stakeId]">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const { stakeId } = await params;
  if (!UUID_PATTERN.test(stakeId)) notFound();
  const { stakes, sites } = await getStakeDirectory(await createClient());
  const stake = stakes.find((candidate) => candidate.id === stakeId);
  if (!stake) notFound();

  return (
    <main className="flex flex-col gap-8">
      <Link href="/staff/stakes" className="font-semibold underline">
        ← 回到支聯會列表
      </Link>
      <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
        {stake.nameZh}
        {!stake.isActive && <InactiveBadge />}
      </h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      {!stake.isActive && (
        <p className="rounded-lg border-2 border-card-outline p-3">
          這個支聯會已停用：它和它的支會都不出現在報名表，舊報名照常顯示。
        </p>
      )}

      <section className={cardClass}>
        <h2 className="text-xl font-bold">支聯會資料</h2>
        <p>區：{REGION_LABELS[stake.region]}（不能改；要改區請停用這個支聯會，再新增一個）</p>
        <form action={saveStakeItem} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={stake.id} />
          <TextPair name="name" label="名稱" zh={stake.nameZh} en={stake.nameEn} required />
          <SiteField sites={sites} value={stake.defaultSite?.siteKey ?? null} />
          <NumberFields position={stake.position} />
          <SubmitButton className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>儲存支聯會資料</SubmitButton>
        </form>
        <ActiveToggle kind="stake" id={stake.id} stakeId={stake.id} isActive={stake.isActive} />
        <DeleteUnit kind="stake" id={stake.id} stakeId={stake.id} label="這個支聯會" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">支會（{stake.wards.length} 個）</h2>
        {stake.wards.length === 0 && <p>還沒有支會。沒有啟用中支會的支聯會不會出現在報名表。</p>}
        <ul className="flex flex-col gap-4">
          {stake.wards.map((ward) => (
            <li key={ward.id} className={cardClass}>
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                {ward.nameZh}
                {!ward.isActive && <InactiveBadge />}
              </h3>
              <form action={saveWardItem} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={ward.id} />
                <input type="hidden" name="stakeId" value={stake.id} />
                <TextPair name="name" label="名稱" zh={ward.nameZh} en={ward.nameEn} required />
                <NumberFields position={ward.position} />
                <SubmitButton className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>儲存</SubmitButton>
              </form>
              <ActiveToggle kind="ward" id={ward.id} stakeId={stake.id} isActive={ward.isActive} />
              <DeleteUnit kind="ward" id={ward.id} stakeId={stake.id} label="這個支會" />
            </li>
          ))}
        </ul>
      </section>

      <section className={cardClass}>
        <h2 className="text-xl font-bold">新增支會</h2>
        <form action={saveWardItem} className="flex flex-col gap-3">
          <input type="hidden" name="stakeId" value={stake.id} />
          <TextPair name="name" label="名稱" required />
          <NumberFields position={nextPosition(stake.wards)} />
          <SubmitButton className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>新增支會</SubmitButton>
        </form>
      </section>
    </main>
  );
}
