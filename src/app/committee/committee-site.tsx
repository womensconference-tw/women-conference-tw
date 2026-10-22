import type { ReactNode } from "react";
import { SubmitButton } from "@/app/staff/submit-button";
import { getCommittee, listPublicCommitteeYears, type Committee, type PublicCommitteeYear } from "@/lib/committee";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/*
 * 籌備委員會公開頁面（#74）各頁共用的部分。工作團隊與籌備委員大多沒有後台帳號，不用登入，知道網址就能看。
 * 預設是目前年度，網址帶 ?year= 可以看過去的年度；還沒到的年度看不到。選單換頁時帶著選的年度（CommitteeNav）。
 */

export type CommitteeYearSearchParams = Promise<{ year?: string | string[] }>;

/** 這一頁要顯示的年度與內容。沒選、或選的年度不公開（網址被改過）時，是目前年度。 */
export async function loadCommittee(searchParams: CommitteeYearSearchParams): Promise<{
  years: PublicCommitteeYear[];
  selected: PublicCommitteeYear | null;
  committee: Committee | null;
}> {
  const supabase = await createClient();
  const [years, { year: yearParam }] = await Promise.all([listPublicCommitteeYears(supabase), searchParams]);
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent) ?? null;
  const committee = selected ? await getCommittee(supabase, selected.id) : null;
  return { years, selected, committee };
}

/** 看過去的年度時，連到其他頁要帶上的網址參數；目前年度不用帶。 */
export function yearQuery(selected: PublicCommitteeYear | null): string {
  return selected && !selected.isCurrent ? `?year=${selected.year}` : "";
}

/** 網頁內容的寬度，和頁首、頁尾對齊。 */
export const committeeWrapClass = "mx-auto w-full max-w-[1120px] px-4 sm:px-6";

export const committeeHeadingClass = "font-committee-serif font-bold tracking-[.06em]";

/** 每一頁的標題、說明與年度選單（有過去的年度才有）。 */
export function CommitteePageHead({
  title,
  lead,
  years,
  selected,
  children,
}: {
  title: string;
  lead?: ReactNode;
  years: PublicCommitteeYear[];
  selected: PublicCommitteeYear | null;
  /** 放在年度選單旁邊，例如籌備委員的搜尋框。 */
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div className="flex flex-col gap-2.5">
        <h1 className={cn(committeeHeadingClass, "text-4xl sm:text-[40px]")}>
          {title}
          {selected && !selected.isCurrent && <span className="ml-3 text-2xl">（{selected.year} 年）</span>}
        </h1>
        {lead && <p className="text-base leading-relaxed text-committee-text-2">{lead}</p>}
      </div>
      {(years.length > 1 || children) && (
        <div className="flex flex-wrap items-end gap-4">
          {children}
          {years.length > 1 && (
            // 沒寫送到哪裡，留在同一頁換年度。
            <form className="flex items-end gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-committee-text-2">年度</span>
                <select
                  name="year"
                  defaultValue={selected?.year}
                  className="h-11 rounded-lg border border-committee-line-strong bg-background px-3 text-[15px]"
                >
                  {years.map((year) => (
                    <option key={year.id} value={year.year}>
                      {year.year} 年{year.isCurrent ? "（目前年度）" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton
                navigates
                pendingLabel="載入中…"
                className="h-11 rounded-lg bg-committee px-4 text-[15px] font-medium text-white hover:bg-committee-hover"
              >
                查看
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** 沒有目前年度，或目前年度什麼都還沒有時。 */
export function CommitteeNotPublished() {
  return <p className="text-committee-text-2">籌備委員會的資訊還沒公布。</p>;
}
