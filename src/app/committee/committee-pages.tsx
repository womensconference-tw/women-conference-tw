import { CommitteeText, LinkList, MeetingList, TeamTable } from "@/components/committee";
import type { Committee, PublicCommitteeYear } from "@/lib/committee";
import { REGION_LABELS, REGIONS } from "@/lib/staff";
import { cn } from "@/lib/utils";
import type { CommitteePageKey } from "./committee-routes";
import { CommitteeNotPublished, committeeHeadingClass, CommitteePageHead, yearQuery } from "./committee-site";
import { MemberDirectory, type DirectoryRegion } from "./members/member-directory";

/**
 * 籌備委員會公開頁面各頁的內容（個人頁除外）。公開頁面與文字頁草稿的預覽（/preview/committee）共用，
 * 預覽時 committee 的文字頁換成草稿，看到的就是發布後的樣子。
 */
export function CommitteePageContent({
  page,
  years,
  selected,
  committee,
}: {
  page: CommitteePageKey;
  years: PublicCommitteeYear[];
  selected: PublicCommitteeYear | null;
  committee: Committee | null;
}) {
  const head = { years, selected };
  switch (page) {
    case "introduction":
      return <TextPage title="大會簡介" head={head} committee={committee} text={committee?.introduction} />;
    case "chairMessage":
      return <TextPage title="主席的話" head={head} committee={committee} text={committee?.chairMessage} />;
    case "meetings":
      return (
        <>
          <CommitteePageHead title="會議記錄" {...head} />
          {committee ? (
            <div className="flex max-w-3xl flex-col gap-12">
              {/* 最上面是籌備委員會備忘錄（組織章程），下面是各次會議的記錄，依日期排列。 */}
              <section className="flex flex-col gap-4">
                <h2 className={cn(committeeHeadingClass, "text-2xl")}>籌備委員會備忘錄</h2>
                <div className="text-lg leading-loose">
                  <CommitteeText text={committee.memorandum} markdown={committee.markdown} />
                </div>
              </section>
              <section className="flex flex-col gap-4">
                <h2 className={cn(committeeHeadingClass, "text-2xl")}>會議記錄</h2>
                <MeetingList meetings={committee.meetings} />
              </section>
            </div>
          ) : (
            <CommitteeNotPublished />
          )}
        </>
      );
    case "team":
      return (
        <>
          <CommitteePageHead
            title="工作團隊"
            lead={
              committee &&
              committee.teamMembers.length > 0 &&
              `總召團與課務、現場、報報、文宣、公關、秘書六組，共 ${committee.teamMembers.length} 位。`
            }
            {...head}
          />
          {committee ? <TeamTable members={committee.teamMembers} /> : <CommitteeNotPublished />}
        </>
      );
    case "members":
      return <MembersPage head={head} committee={committee} />;
    case "plan":
      return (
        <>
          <CommitteePageHead title="執行計畫" {...head} />
          {committee ? (
            <div className="flex max-w-3xl flex-col gap-12">
              <div className="text-lg leading-loose">
                <CommitteeText text={committee.executionPlan} markdown={committee.markdown} />
              </div>
              {/* 重要連結（例如執行計畫試算表）。 */}
              {committee.links.length > 0 && (
                <section className="flex flex-col gap-4">
                  <h2 className={cn(committeeHeadingClass, "text-2xl")}>重要連結</h2>
                  <LinkList links={committee.links} />
                </section>
              )}
            </div>
          ) : (
            <CommitteeNotPublished />
          )}
        </>
      );
  }
}

type Head = { years: PublicCommitteeYear[]; selected: PublicCommitteeYear | null };

function TextPage({ title, head, committee, text }: { title: string; head: Head; committee: Committee | null; text?: string }) {
  return (
    <>
      <CommitteePageHead title={title} {...head} />
      {committee ? (
        <div className="max-w-3xl text-lg leading-loose">
          <CommitteeText text={text ?? ""} markdown={committee.markdown} />
        </div>
      ) : (
        <CommitteeNotPublished />
      )}
    </>
  );
}

/**
 * 籌備委員名單（設計稿 docs/design/committee.html）：依北、中、南區分組，每位一張卡片，有照片的顯示照片、
 * 沒有的顯示姓氏。可以搜尋姓名或支聯會。點卡片進個人頁。
 */
function MembersPage({ head, committee }: { head: Head; committee: Committee | null }) {
  const members = committee?.members ?? [];
  // 名單已經依支聯會的順序排好，分組後各區照樣是這個順序。支聯會沒有區的（照理不會有）放在最後。
  const regions: DirectoryRegion[] = [
    ...REGIONS.map((region) => ({ id: region, name: REGION_LABELS[region], members: members.filter((m) => m.stakeRegion === region) })),
    { id: "other", name: "其他", members: members.filter((m) => m.stakeRegion === null) },
  ]
    .filter((region) => region.members.length > 0)
    .map((region) => ({
      ...region,
      members: region.members.map((m) => ({ id: m.id, name: m.name, stakeName: m.stakeName, photoUrl: m.photoUrl })),
    }));
  const stakeCount = new Set(members.map((m) => m.stakeId)).size;

  return (
    <>
      <CommitteePageHead
        title="籌備委員"
        lead={members.length > 0 && `來自全台 ${stakeCount} 個支聯會、共 ${members.length} 位姐妹，依北、中、南區排列。`}
        {...head}
      />
      {!committee ? (
        <CommitteeNotPublished />
      ) : members.length === 0 ? (
        <p className="text-committee-text-2">還沒有名單。</p>
      ) : (
        <MemberDirectory regions={regions} memberQuery={yearQuery(head.selected)} />
      )}
    </>
  );
}
