import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CommitteeNavList } from "@/app/committee/committee-nav";
import { CommitteePageContent } from "@/app/committee/committee-pages";
import { COMMITTEE_PAGES, type CommitteePageKey } from "@/app/committee/committee-routes";
import { CommitteeShell } from "@/app/committee/committee-shell";
import { committeeWrapClass } from "@/app/committee/committee-site";
import { COMMITTEE_DONE, COMMITTEE_ERRORS } from "@/app/staff/(signed-in)/committee/messages";
import { publishTextsAction } from "@/app/staff/(signed-in)/committee/actions";
import { getCurrentStaff } from "@/app/staff/current-staff";
import { ResultMessage } from "@/app/staff/result-message";
import { SubmitButton } from "@/app/staff/submit-button";
import { buttonClass } from "@/app/staff/ui";
import { changedPagesSummary, committeePageClass } from "@/components/committee";
import { buttonVariants } from "@/components/ui/button";
import { changedTextPages, getCommittee, getCommitteeTextDraft, type CommitteeTextKey } from "@/lib/committee";
import { languageTags } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences } from "@/lib/years";
import { PreviewBanner } from "../preview-banner";

export const metadata: Metadata = { title: "預覽籌備委員會" };

/** 每個文字頁在公開頁面的哪一頁：備忘錄在「會議記錄」那一頁的最上面。 */
const TEXT_PAGES: Record<CommitteeTextKey, CommitteePageKey> = {
  introduction: "introduction",
  chairMessage: "chairMessage",
  memorandum: "meetings",
  executionPlan: "plan",
};

/**
 * 籌備委員會文字頁草稿的預覽（#76）：和公開頁面 /committee 一樣有頁首選單、一頁一項，文字頁換成草稿，其他內容照舊。
 * 用選單切換各頁（網址的 page），有修改的頁面在選單上標一個點；一打開先看第一個有修改的頁面。
 * 只有總管理員看得到。確定後按「發布」，帶著這裡顯示的草稿版本代號，確認發布的就是預覽過的那一版。
 * proxy 已經擋下沒登入的人；這裡再確認是總管理員，草稿本身也只有總管理員讀得到（資料庫的權限規則）。
 */
export default async function CommitteePreviewPage({ searchParams }: PageProps<"/preview/committee">) {
  const supabase = await createClient();
  const [me, years, { year: yearParam, page: pageParam }] = await Promise.all([
    getCurrentStaff(),
    listConferences(supabase),
    searchParams,
  ]);
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") redirect("/staff/committee");

  // 和後台籌備委員會頁一樣：沒選、或選的年度不在清單裡時，是目前年度。
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent);
  const [committee, draft] = selected
    ? await Promise.all([getCommittee(supabase, selected.id), getCommitteeTextDraft(supabase, selected.id)])
    : [null, null];
  const back = `/staff/committee${selected ? `?year=${selected.year}` : ""}`;

  if (!selected || !committee || !draft) {
    return (
      <main lang={languageTags.zh} className={committeePageClass}>
        <ResultMessage searchParams={searchParams} done={COMMITTEE_DONE} errors={COMMITTEE_ERRORS} />
        <PreviewBanner>沒有尚未發布的修改，大家看到的就是已發布的版本。</PreviewBanner>
        <Link href={back} className={cn(buttonVariants({ variant: "outline" }), buttonClass, "self-start font-bold")}>
          回籌備委員會
        </Link>
      </main>
    );
  }

  const changed = changedTextPages(committee, draft);
  const changedPages = new Set(changed.map((key) => TEXT_PAGES[key]));
  const page =
    COMMITTEE_PAGES.find((item) => item.key === pageParam)?.key ??
    COMMITTEE_PAGES.find((item) => changedPages.has(item.key))?.key ??
    "introduction";
  // 預覽的年度照公開頁面的規則顯示：目前年度不標年份，其他年度標在標題旁。不給選年度，預覽的是這一個年度的草稿。
  const year = { id: selected.id, year: selected.year, isCurrent: selected.isCurrent };

  return (
    <div className="flex flex-1 flex-col">
      <div lang={languageTags.zh} className={cn(committeeWrapClass, "flex flex-col gap-3 py-4")}>
        <ResultMessage searchParams={searchParams} done={COMMITTEE_DONE} errors={COMMITTEE_ERRORS} />
        <PreviewBanner>
          預覽：這是發布後公開頁面的樣子，大家還看不到。
          {changedPagesSummary(changed)}
          用下方的選單切換各頁，有修改的頁面標了一個點。
        </PreviewBanner>
        <div className="flex flex-wrap items-start gap-3">
          <form action={publishTextsAction}>
            <input type="hidden" name="conferenceId" value={selected.id} />
            <input type="hidden" name="year" value={selected.year} />
            <input type="hidden" name="revision" value={draft.revision} />
            <SubmitButton pendingLabel="發布中…" className={cn(buttonVariants(), buttonClass, "font-bold")}>
              發布
            </SubmitButton>
          </form>
          <Link href={back} className={cn(buttonVariants({ variant: "outline" }), buttonClass, "font-bold")}>
            回去繼續編輯
          </Link>
        </div>
      </div>
      <CommitteeShell
        homeHref={`/preview/committee?year=${selected.year}&page=introduction`}
        nav={
          <CommitteeNavList
            items={COMMITTEE_PAGES.map((item) => ({
              label: item.label,
              href: `/preview/committee?year=${selected.year}&page=${item.key}`,
              current: item.key === page,
              changed: changedPages.has(item.key),
            }))}
          />
        }
      >
        {/* 存草稿就是 Markdown，發布後照樣式排版（#75）。 */}
        <CommitteePageContent page={page} years={[]} selected={year} committee={{ ...committee, ...draft, markdown: true }} />
      </CommitteeShell>
    </div>
  );
}
