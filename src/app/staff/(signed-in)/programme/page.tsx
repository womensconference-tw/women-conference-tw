import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProgramme } from "@/lib/programme";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "../../current-staff";
import { ResultMessage } from "../../result-message";
import { REGION_LABELS } from "@/lib/staff";
import { DONE, ERRORS, ItemForm, NumberFields, RegionField } from "./forms";
import { TextPair } from "../../text-pair";

export const metadata: Metadata = { title: "場地與課程" };

/** 場地與課程（只有總管理員）：目前年度的場地列表，可新增場地，點進去編輯場次、課程、午餐、午后動態。 */
export default async function ProgrammePage({ searchParams }: PageProps<"/staff/programme">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const programme = await getProgramme(await createClient());

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">場地與課程{programme && `（${programme.year} 年）`}</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      {!programme ? (
        <p>還沒有目前年度，請先設定目前年度。</p>
      ) : (
        <>
          {programme.registrationOpened && (
            <p className="rounded-lg border-2 border-card-outline p-3">
              報名已經開放：場地、場次、課程、成對課程、午餐、午后動態不能再新增、刪除或換時段，只能修正文字、調整名額、排序與教室。
            </p>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">場地（{programme.venues.length} 個）</h2>
            {programme.venues.length === 0 && <p>還沒有場地。</p>}
            <ul className="flex flex-col gap-3">
              {programme.venues.map((venue) => {
                const courses = venue.sessions.reduce((sum, session) => sum + session.courses.length, 0);
                return (
                  <li key={venue.id}>
                    <Link
                      href={`/staff/programme/${venue.id}`}
                      className="flex flex-col gap-1 rounded-lg border-2 border-card-outline p-4 hover:bg-muted"
                    >
                      <span className="text-lg font-bold underline">{venue.nameZh}</span>
                      <span className="text-sm text-muted-foreground">
                        {REGION_LABELS[venue.region]}・{venue.sessions.length} 個場次、{courses} 門課程、{venue.lunchOptions.length} 種午餐、
                        {venue.afternoonActivities.length} 個午后動態
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

            {!programme.registrationOpened && (
            <section className="flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4">
              <h2 className="text-xl font-bold">新增場地</h2>
              <ItemForm kind="venue" conferenceId={programme.conferenceId} submitLabel="新增場地">
                <TextPair name="name" label="名稱" required />
                <RegionField />
                <TextPair name="address" label="地址" />
                <TextPair name="features" label="場地特色" multiline />
                <NumberFields position={programme.venues.length + 1} />
              </ItemForm>
          </section>
          )}
        </>
      )}
    </main>
  );
}
