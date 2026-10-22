"use client";

import { useId, useState } from "react";
import { NavLink } from "@/app/staff/nav-link";
import { cn } from "@/lib/utils";

export type DirectoryMember = { id: string; name: string; stakeName: string; photoUrl: string | null };
export type DirectoryRegion = { id: string; name: string; members: DirectoryMember[] };

/**
 * 籌備委員的卡片名單：搜尋框、各區的快捷鈕（顯示人數），再來是各區的卡片。
 * 搜尋姓名或支聯會時只留下符合的委員，快捷鈕的人數跟著變；都不符合時說明找不到。
 * memberQuery 是連到個人頁要帶的年度（看過去的年度時）。
 */
export function MemberDirectory({ regions, memberQuery }: { regions: DirectoryRegion[]; memberQuery: string }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = regions
    .map((region) => ({ ...region, members: region.members.filter((m) => !q || m.name.includes(q) || m.stakeName.includes(q)) }))
    .filter((region) => region.members.length > 0);

  return (
    <div className="flex flex-col">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-5 border-b border-committee-line pb-7">
        <nav aria-label="地區" className="flex flex-wrap gap-2">
          {shown.map((region) => (
            <a
              key={region.id}
              href={`#${region.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-committee-line-strong px-4 text-[15px] text-[#1f2933] no-underline hover:border-committee"
            >
              {region.name}
              <span className="text-[13px] text-committee-text-3">{region.members.length}</span>
            </a>
          ))}
        </nav>
        <div className="flex w-[300px] max-w-full flex-col gap-1.5">
          <label htmlFor={searchId} className="text-[13px] text-committee-text-2">
            搜尋姓名或支聯會
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：台南、陳"
            className="h-11 rounded-lg border border-committee-line-strong px-3.5 text-[15px] focus:outline-2 focus:outline-offset-1 focus:outline-committee"
          />
        </div>
      </div>

      {shown.length === 0 && <p className="text-committee-text-2">找不到符合的委員。</p>}
      {shown.map((region) => (
        <section key={region.id} id={region.id} className="mb-14 flex scroll-mt-6 flex-col gap-5">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[22px] font-bold">{region.name}</h2>
            <span className="text-sm text-committee-text-3">{region.members.length} 位</span>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {region.members.map((member) => (
              <li key={member.id}>
                <NavLink
                  href={`/committee/members/${member.id}${memberQuery}`}
                  className="flex items-center gap-3.5 rounded-xl border border-committee-line px-4 py-3.5 text-[#1f2933] no-underline hover:border-committee"
                >
                  <MemberAvatar name={member.name} photoUrl={member.photoUrl} className="size-16 text-2xl" />
                  <span className="min-w-0">
                    <span className="block text-lg font-bold tracking-[.04em]">{member.name}</span>
                    <span className="mt-1 block text-sm text-committee-text-2">{member.stakeName}</span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** 圓形大頭照；沒有照片時顯示姓氏。旁邊已經寫了姓名，照片不必再讀一次姓名給螢幕閱讀器。 */
function MemberAvatar({ name, photoUrl, className }: { name: string; photoUrl: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex flex-none items-center justify-center overflow-hidden rounded-full bg-committee-tint font-committee-serif font-bold text-committee",
        className,
      )}
    >
      {photoUrl ? (
        // 照片放在存放空間（Supabase），不經過 Next.js 的圖片最佳化。
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" />
      ) : (
        name.charAt(0)
      )}
    </span>
  );
}
