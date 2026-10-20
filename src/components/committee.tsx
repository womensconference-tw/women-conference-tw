import type { ReactNode } from "react";
import {
  COMMITTEE_TEAM_LABELS,
  roleLabel,
  type Committee,
  type CommitteeTextKey,
  type CommitteeLink,
  type CommitteeMember,
  type Meeting,
  type TeamMember,
} from "@/lib/committee";
import { REGION_LABELS } from "@/lib/staff";
import { ExternalLink } from "./external-link";
import { Markdown } from "./markdown";

/*
 * 籌備委員會資訊的顯示，後台籌備委員會頁面與公開頁面 /committee 共用（#74）。
 * 後台的總管理員傳入 manage，在每一項旁邊放編輯、刪除等功能。文字頁草稿的預覽（#76）也用公開頁面這一套。
 */

/** 公開頁面與草稿預覽的版面。 */
export const committeePageClass = "mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-5 pt-6 pb-10 leading-relaxed";

/** 公開頁面的內容：三個文字頁、會議記錄、重要連結與兩份名單，只能看不能改。 */
export function CommitteeView({ committee }: { committee: Committee }) {
  return (
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
  );
}

export const committeeCardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";
const tableClass = "w-full border-collapse text-left [&_td]:border-t [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2";

export const COMMITTEE_TEXT_PAGES = [
  { name: "introduction", key: "introduction", label: "大會簡介", hint: "日期、場地、宗旨、主題經文。" },
  { name: "chairMessage", key: "chairMessage", label: "主席的話", hint: "主席的自我介紹與勉勵。" },
  {
    name: "memorandum",
    key: "memorandum",
    label: "籌備委員會備忘錄",
    hint: "籌備委員會的組織章程。頁面下方已有工作團隊與籌備委員的名單，備忘錄裡的名單可以只寫「見下方名單」，不必兩邊都維護。",
  },
] as const;

/**
 * 三個文字頁。改版前存的純文字照原樣顯示（保留空格與換行），存過 Markdown 的才依樣式排版（#75）。
 * changed 是草稿裡有修改、還沒發布的頁面，在標題旁標示（後台，#76）。
 */
export function CommitteeTexts({
  texts,
  changed = [],
}: {
  texts: Pick<Committee, "introduction" | "chairMessage" | "memorandum" | "markdown">;
  changed?: readonly CommitteeTextKey[];
}) {
  return COMMITTEE_TEXT_PAGES.map((page) => (
    <section key={page.key} className="flex flex-col gap-3">
      <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold">
        {page.label}
        {changed.includes(page.key) && <UnpublishedBadge />}
      </h2>
      {texts[page.key] ? (
        texts.markdown ? (
          <Markdown>{texts[page.key]}</Markdown>
        ) : (
          <p className="whitespace-pre-wrap break-words">{texts[page.key]}</p>
        )
      ) : (
        <p className="text-muted-foreground">還沒有內容。</p>
      )}
    </section>
  ));
}

/** 草稿裡哪幾頁有修改，例如「主席的話、籌備委員會備忘錄有修改。」（#76）。 */
export function changedPagesSummary(changed: readonly CommitteeTextKey[]): string {
  if (changed.length === 0) return "草稿和已發布的版本相同。";
  const labels = COMMITTEE_TEXT_PAGES.filter((page) => changed.includes(page.key)).map((page) => page.label);
  return `${labels.join("、")}有修改。`;
}

/** 標示這一頁有尚未發布的修改。 */
export function UnpublishedBadge() {
  return (
    <span className="rounded-full border-2 border-primary px-2 py-0.5 text-sm font-semibold">有尚未發布的修改</span>
  );
}

export function MeetingList({ meetings, manage }: { meetings: Meeting[]; manage?: ((meeting: Meeting) => ReactNode) | null }) {
  return (
    <>
      {meetings.length === 0 && <p className="text-muted-foreground">還沒有會議記錄。</p>}
      <ol className="flex flex-col gap-3">
        {meetings.map((meeting) => (
          <li key={meeting.id} className={committeeCardClass}>
            <p className="text-sm text-muted-foreground">{meeting.meetingDate.replaceAll("-", "/")}</p>
            <ExternalLink href={meeting.url} className="text-lg font-bold">
              {meeting.title}
            </ExternalLink>
            {meeting.note && <p className="whitespace-pre-wrap break-words">{meeting.note}</p>}
            {manage?.(meeting)}
          </li>
        ))}
      </ol>
    </>
  );
}

export function LinkList({
  links,
  manage,
}: {
  links: CommitteeLink[];
  manage?: ((link: CommitteeLink, index: number) => ReactNode) | null;
}) {
  return (
    <>
      {links.length === 0 && <p className="text-muted-foreground">還沒有連結。</p>}
      <ol className="flex flex-col gap-3">
        {links.map((link, index) => (
          <li key={link.id} className={manage ? committeeCardClass : undefined}>
            <ExternalLink href={link.url} className="text-lg font-bold">
              {link.title}
            </ExternalLink>
            {manage?.(link, index)}
          </li>
        ))}
      </ol>
    </>
  );
}

/** 工作團隊一張表，照舊籌備網站的欄位；依組別再依職務排列（getCommittee 已排好）。 */
export function TeamTable({ members, manage }: { members: TeamMember[]; manage?: ((member: TeamMember) => ReactNode) | null }) {
  if (members.length === 0) return <p className="text-muted-foreground">還沒有名單。</p>;
  return (
    <div className="overflow-x-auto">
      <table className={tableClass}>
        <thead>
          <tr>
            <th>組別</th>
            <th>擔任職務</th>
            <th>姓名</th>
            <th>所屬區域</th>
            <th>所屬支聯會</th>
            {manage && <th>管理</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="align-top">
              <td>{COMMITTEE_TEAM_LABELS[member.team]}</td>
              <td>{roleLabel(member.team, member.role)}</td>
              <td>{member.name}</td>
              <td>{member.region ? REGION_LABELS[member.region] : "全區"}</td>
              <td>{member.stakeName}</td>
              {manage && <td>{manage(member)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 籌備委員一張表，照舊籌備網站的欄位；依支聯會名單的順序排列（getCommittee 已排好）。 */
export function MemberTable({
  members,
  manage,
}: {
  members: CommitteeMember[];
  manage?: ((member: CommitteeMember) => ReactNode) | null;
}) {
  if (members.length === 0) return <p className="text-muted-foreground">還沒有名單。</p>;
  return (
    <div className="overflow-x-auto">
      <table className={tableClass}>
        <thead>
          <tr>
            <th>所屬區域</th>
            <th>所屬支聯會</th>
            <th>籌備委員姓名</th>
            <th>是否為慈助會會長團成員</th>
            {manage && <th>管理</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="align-top">
              <td>{member.stakeRegion ? REGION_LABELS[member.stakeRegion] : ""}</td>
              <td>{member.stakeName}</td>
              <td>{member.name}</td>
              <td>{member.reliefSocietyPresidency ? "✓ 是" : ""}</td>
              {manage && <td>{manage(member)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
