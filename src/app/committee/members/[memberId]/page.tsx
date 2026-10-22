import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NavLink } from "@/app/staff/nav-link";
import { getPublicCommitteeMember } from "@/lib/committee";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { committeeHeadingClass, yearQuery } from "../../committee-site";

export async function generateMetadata({ params }: PageProps<"/committee/members/[memberId]">): Promise<Metadata> {
  const found = await getPublicCommitteeMember(await createClient(), (await params).memberId);
  return { title: found ? `${found.member.name}｜籌備委員` : "籌備委員" };
}

/**
 * 一位籌備委員的個人頁（設計稿 docs/design/committee-member-page.html）：照片、支聯會、姓名與自我介紹。
 * 照片與介紹由總管理員在後台籌備委員會頁填；沒有照片時顯示姓氏，沒有介紹時說明還沒提供。
 * 只有公開年度的委員找得到，其他（還沒到的年度、已刪除、網址打錯）顯示找不到。
 */
export default async function CommitteeMemberPage({ params }: PageProps<"/committee/members/[memberId]">) {
  const found = await getPublicCommitteeMember(await createClient(), (await params).memberId);
  if (!found) notFound();
  const { member, year } = found;

  return (
    <div className="-mt-4 sm:-mt-6">
      <NavLink
        href={`/committee/members${yearQuery(year)}`}
        className="inline-flex min-h-11 items-center text-[15px] text-[#3e4c59] no-underline hover:text-committee"
      >
        ‹ 回到委員名單
      </NavLink>
      <div className="mt-4 flex flex-wrap items-start gap-x-16 gap-y-10">
        <div className="max-w-full flex-[0_1_420px] rounded-[20px] bg-committee-tint p-5">
          {member.photoUrl ? (
            // 照片放在存放空間（Supabase），不經過 Next.js 的圖片最佳化。直式 3:4，臉部置中偏上。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.photoUrl}
              alt={member.name}
              className="block aspect-[3/4] w-full rounded-xl object-cover object-top"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex aspect-[3/4] w-full items-center justify-center rounded-xl bg-white font-committee-serif text-8xl font-bold text-committee"
            >
              {member.name.charAt(0)}
            </div>
          )}
        </div>
        <article className="flex min-w-0 flex-[999_1_420px] flex-col gap-7 pt-6">
          <div>
            <p className="text-[15px] font-medium tracking-[.04em] text-committee">
              {member.stakeName}
              {member.reliefSocietyPresidency && "・慈助會會長團"}
            </p>
            <h1 className={cn(committeeHeadingClass, "mt-2.5 text-[40px] leading-tight tracking-[.08em] sm:text-[52px]")}>
              {member.name}
            </h1>
            <div aria-hidden="true" className="mt-[18px] h-[3px] w-12 rounded-sm bg-committee" />
          </div>
          {member.bio ? (
            <p className="max-w-[34em] whitespace-pre-line break-words text-lg leading-[2.1] text-[#323f4b]">{member.bio}</p>
          ) : (
            <p className="text-lg text-committee-text-3">自我介紹還沒提供。</p>
          )}
        </article>
      </div>
    </div>
  );
}
