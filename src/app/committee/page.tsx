import type { Metadata } from "next";
import { SubmitButton } from "@/app/staff/submit-button";
import { CommitteeTexts, LinkList, MeetingList, MemberTable, TeamTable } from "@/components/committee";
import { buttonVariants } from "@/components/ui/button";
import { getCommittee, listPublicCommitteeYears } from "@/lib/committee";
import { languageTags } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// 名單上有每位姐妹的全名與支聯會，不給搜尋引擎收錄；前台首頁也不連到這裡，由總管理員把網址傳給大家（#74）。
// 分享到 LINE 時的預覽也換成籌備委員會，不沿用報名網站的標題與說明。
const DESCRIPTION = "台灣姐妹大會籌備委員會：大會簡介、主席的話、備忘錄、會議記錄、工作團隊與籌備委員名單。";
export const metadata: Metadata = {
  title: "籌備委員會",
  description: DESCRIPTION,
  openGraph: { title: "籌備委員會", description: DESCRIPTION },
  robots: { index: false, follow: false },
};

/**
 * 公開的籌備委員會頁面（#74）：工作團隊與籌備委員大多沒有後台帳號，不用登入，知道網址就能看。
 * 內容和後台籌備委員會頁面相同，只能看不能改。預設是目前年度，可以選過去的年度；還沒到的年度看不到。
 */
export default async function PublicCommitteePage({ searchParams }: PageProps<"/committee">) {
  const supabase = await createClient();
  const [years, { year: yearParam }] = await Promise.all([listPublicCommitteeYears(supabase), searchParams]);
  // 沒選、或選的年度不公開（網址被改過）時，是目前年度。
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent);
  const committee = selected ? await getCommittee(supabase, selected.id) : null;

  return (
    // 內容只有中文；前台選了英文的訪客，網頁的語言（html lang）會是英文，這裡標回中文。
    <main lang={languageTags.zh} className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-5 pt-6 pb-10 leading-relaxed">
      <h1 className="text-2xl font-bold">籌備委員會{selected && `（${selected.year} 年）`}</h1>
      {years.length > 1 && (
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 sm:w-48">
            <span className="font-semibold">年度</span>
            <select
              name="year"
              defaultValue={selected?.year}
              className="min-h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2"
            >
              {years.map((year) => (
                <option key={year.id} value={year.year}>
                  {year.year} 年{year.isCurrent ? "（目前年度）" : ""}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton navigates pendingLabel="載入中…" className={cn(buttonVariants(), "h-auto min-h-11 px-4 py-2 text-base font-bold")}>
            查看
          </SubmitButton>
        </form>
      )}

      {!committee ? (
        <p>籌備委員會的資訊還沒公布。</p>
      ) : (
        <>
          <CommitteeTexts texts={committee} />
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold">會議記錄</h2>
            <MeetingList meetings={committee.meetings} />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold">重要連結</h2>
            <LinkList links={committee.links} />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold">工作團隊</h2>
            <TeamTable members={committee.teamMembers} />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-bold">籌備委員</h2>
            <MemberTable members={committee.members} />
          </section>
        </>
      )}
    </main>
  );
}
