import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { COMMITTEE_DONE, COMMITTEE_ERRORS } from "@/app/staff/(signed-in)/committee/messages";
import { publishTextsAction } from "@/app/staff/(signed-in)/committee/actions";
import { getCurrentStaff } from "@/app/staff/current-staff";
import { ResultMessage } from "@/app/staff/result-message";
import { SubmitButton } from "@/app/staff/submit-button";
import { buttonClass } from "@/app/staff/ui";
import { changedPagesSummary, committeePageClass, CommitteeView } from "@/components/committee";
import { buttonVariants } from "@/components/ui/button";
import { changedTextPages, getCommittee, getCommitteeTextDraft } from "@/lib/committee";
import { languageTags } from "@/lib/i18n/locale";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences } from "@/lib/years";
import { PreviewBanner } from "../preview-banner";

export const metadata: Metadata = { title: "預覽籌備委員會" };

/**
 * 籌備委員會三個文字頁草稿的預覽（#76）：照公開頁面 /committee 的樣子，三個文字頁換成草稿，其他內容照舊。
 * 只有總管理員看得到。確定後按「發布」，帶著這裡顯示的草稿版本代號，確認發布的就是預覽過的那一版。
 * proxy 已經擋下沒登入的人；這裡再確認是總管理員，草稿本身也只有總管理員讀得到（資料庫的權限規則）。
 */
export default async function CommitteePreviewPage({ searchParams }: PageProps<"/preview/committee">) {
  const supabase = await createClient();
  const [me, years, { year: yearParam }] = await Promise.all([getCurrentStaff(), listConferences(supabase), searchParams]);
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") redirect("/staff/committee");

  // 和後台籌備委員會頁一樣：沒選、或選的年度不在清單裡時，是目前年度。
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent);
  const [committee, draft] = selected
    ? await Promise.all([getCommittee(supabase, selected.id), getCommitteeTextDraft(supabase, selected.id)])
    : [null, null];
  const changed = committee ? changedTextPages(committee, draft) : [];
  const back = `/staff/committee${selected ? `?year=${selected.year}` : ""}`;

  return (
    <main lang={languageTags.zh} className={committeePageClass}>
      <ResultMessage searchParams={searchParams} done={COMMITTEE_DONE} errors={COMMITTEE_ERRORS} />
      {!selected || !committee || !draft ? (
        <>
          <PreviewBanner>沒有尚未發布的修改，大家看到的就是已發布的版本。</PreviewBanner>
          <Link href={back} className={cn(buttonVariants({ variant: "outline" }), buttonClass, "self-start font-bold")}>
            回籌備委員會
          </Link>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <PreviewBanner>
              預覽：這是發布後公開頁面的樣子，大家還看不到。
              {changedPagesSummary(changed)}
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
          <h1 className="text-2xl font-bold">籌備委員會（{selected.year} 年）</h1>
          {/* 存草稿就是 Markdown，發布後照樣式排版（#75）。 */}
          <CommitteeView committee={{ ...committee, ...draft, markdown: true }} />
        </>
      )}
    </main>
  );
}
