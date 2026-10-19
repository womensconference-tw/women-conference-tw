import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  COMMITTEE_TEXT_PAGES,
  CommitteeTexts,
  committeeCardClass as cardClass,
  LinkList,
  MeetingList,
  MemberTable,
  TeamTable,
} from "@/components/committee";
import { buttonVariants } from "@/components/ui/button";
import {
  COMMITTEE_TEAM_LABELS,
  COMMITTEE_TEAMS,
  getCommittee,
  listPublicCommitteeYears,
  type CommitteeError,
  type CommitteeItemKind,
  type CommitteeLink,
  type CommitteeMember,
  type Meeting,
  type TeamMember,
} from "@/lib/committee";
import { REGION_LABELS, REGIONS } from "@/lib/staff";
import { getStakeDirectory, type DirectoryStake } from "@/lib/stakes";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences } from "@/lib/years";
import { getCurrentStaff } from "../../current-staff";
import { Field } from "../../fields";
import { ResultMessage } from "../../result-message";
import { SubmitButton } from "../../submit-button";
import { buttonClass, inputClass } from "../../ui";
import { CopyUrl } from "./copy-url";
import {
  deleteItemAction,
  moveLinkAction,
  saveLinkAction,
  saveMeetingAction,
  saveMemberAction,
  saveTeamMemberAction,
  saveTextsAction,
} from "./actions";

export const metadata: Metadata = { title: "籌備委員會" };

const submitClass = cn(buttonVariants(), buttonClass, "self-start font-bold");

const DONE: Record<string, string> = {
  saved: "已儲存。",
  moved: "已調整順序。",
  deleted: "已刪除。",
};

const ERRORS: Record<CommitteeError, string> = {
  not_admin: "只有總管理員能編輯籌備委員會資訊。",
  title_required: "請填標題。",
  name_required: "請填姓名。",
  date_invalid: "請選會議日期。",
  url_invalid: "連結要是 https:// 或 http:// 開頭的完整網址，不能有空白。",
  team_invalid: "請選組別。",
  role_invalid: "請選職務。",
  region_invalid: "請選北區、中區、南區或全區。",
  stake_required: "請選支聯會。",
  not_found: "找不到這一項，可能已經被刪除。請重新整理頁面再試一次。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

/** 這一個年度的表單都要帶的欄位：寫到哪個年度、做完回到哪個年度。 */
type YearFields = { conferenceId: string; year: number };

/**
 * 籌備委員會（所有工作人員都看得到，只有總管理員能編輯）：大會簡介、主席的話、籌備委員會備忘錄、
 * 會議記錄、重要連結、工作團隊與籌備委員名單。預設是目前年度，可以選年度看別的年度。
 * 名單只是資訊，名單上的人不會因此有後台帳號。目前與過去年度不用登入也能在公開頁面 /committee 看（#74），
 * 這裡放公開網址，方便總管理員傳給工作團隊與籌備委員。
 */
export default async function CommitteePage({ searchParams }: PageProps<"/staff/committee">) {
  const supabase = await createClient();
  const [me, years, { year: yearParam }] = await Promise.all([getCurrentStaff(), listConferences(supabase), searchParams]);
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  const canEdit = me.role === "admin";

  // 沒選、或選的年度不在清單裡（網址被改過）時，是目前年度。
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent);
  const [committee, directory, publicYears] = await Promise.all([
    selected ? getCommittee(supabase, selected.id) : null,
    canEdit ? getStakeDirectory(supabase) : null,
    listPublicCommitteeYears(supabase),
  ]);
  const stakes = directory?.stakes ?? [];
  // 總管理員才有的編輯表單；表單帶著這個年度，寫到這個年度、做完回到這個年度。
  const edit = canEdit && selected ? { conferenceId: selected.id, year: selected.year } : null;
  // 公開頁面看得到哪些年度由資料庫決定（目前與過去年度）。
  const isPublic = publicYears.some((year) => year.id === selected?.id);
  // 看舊年度時帶上年度。網域由瀏覽器補上（CopyUrl）。
  const publicPath = `/committee${selected && !selected.isCurrent ? `?year=${selected.year}` : ""}`;

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">籌備委員會{selected && `（${selected.year} 年）`}</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      {(years.length > 1 || (years.length > 0 && !selected)) && (
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 sm:w-48">
            <span className="font-semibold">年度</span>
            <select name="year" defaultValue={selected?.year} className={inputClass}>
              {years.map((year) => (
                <option key={year.id} value={year.year}>
                  {year.year} 年{year.isCurrent ? "（目前年度）" : ""}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton navigates pendingLabel="載入中…" className={cn(buttonVariants(), buttonClass, "font-bold")}>
            查看
          </SubmitButton>
        </form>
      )}

      {!selected || !committee ? (
        <p>{years.length === 0 ? "還沒有年度大會。" : "還沒有設定目前年度，請選年度查看。"}</p>
      ) : (
        <>
          <section className={cardClass}>
            <h2 className="text-lg font-bold">公開網址</h2>
            {isPublic ? (
              <>
                <p>
                  目前與過去年度的籌備委員會資訊不用登入就能看，把這個網址傳給工作團隊與籌備委員。
                  前台首頁沒有連到這裡，搜尋引擎也不會收錄。
                </p>
                <CopyUrl key={publicPath} path={publicPath} />
              </>
            ) : (
              <p>這個年度還沒成為目前年度，公開頁面還看不到，只有工作人員看得到。設為目前年度後就會公開。</p>
            )}
          </section>
          <p>{canEdit ? "名單只是資訊，名單上的人不會因此有後台帳號。" : "只有總管理員能修改。"}</p>
          <Texts texts={committee} edit={edit} />
          <Meetings meetings={committee.meetings} edit={edit} />
          <Links links={committee.links} edit={edit} />
          <Team members={committee.teamMembers} stakes={stakes} edit={edit} />
          <Members members={committee.members} stakes={stakes} edit={edit} />
        </>
      )}
    </main>
  );
}

function Texts({
  texts,
  edit,
}: {
  texts: { introduction: string; chairMessage: string; memorandum: string };
  edit: YearFields | null;
}) {
  return (
    <>
      <CommitteeTexts texts={texts} />
      {edit && (
        <details className={cardClass}>
          <summary className="cursor-pointer text-lg font-bold">編輯大會簡介、主席的話、備忘錄</summary>
          <form action={saveTextsAction} className="mt-3 flex flex-col gap-3">
            <YearInputs {...edit} />
            {COMMITTEE_TEXT_PAGES.map((page) => (
              <Field key={page.key} label={page.label} hint={page.hint}>
                <textarea name={page.name} defaultValue={texts[page.key]} rows={8} className={inputClass} />
              </Field>
            ))}
            <SubmitButton className={submitClass}>儲存</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}

function Meetings({ meetings, edit }: { meetings: Meeting[]; edit: YearFields | null }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">會議記錄（{meetings.length} 筆）</h2>
      <MeetingList
        meetings={meetings}
        manage={
          edit &&
          ((meeting) => (
            <>
              <details>
                <summary className="cursor-pointer font-semibold">編輯會議記錄</summary>
                <div className="mt-3">
                  <MeetingForm edit={edit} meeting={meeting} submitLabel="儲存會議記錄" />
                </div>
              </details>
              <DeleteForm edit={edit} kind="meeting" id={meeting.id} noun="會議記錄" />
            </>
          ))
        }
      />
      {edit && (
        <AddDetails label="新增會議記錄">
          <MeetingForm edit={edit} submitLabel="新增會議記錄" />
        </AddDetails>
      )}
    </section>
  );
}

function MeetingForm({ edit, meeting, submitLabel }: { edit: YearFields; meeting?: Meeting; submitLabel: string }) {
  return (
    <form action={saveMeetingAction} className="flex flex-col gap-3">
      <YearInputs {...edit} />
      {meeting && <input type="hidden" name="id" value={meeting.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="標題" required>
          <input name="title" defaultValue={meeting?.title} required className={inputClass} />
        </Field>
        <Field label="日期" required>
          <input name="meetingDate" type="date" defaultValue={meeting?.meetingDate} required className={inputClass} />
        </Field>
      </div>
      <UrlField value={meeting?.url} hint="Canva 簡報、Google 文件等，https:// 開頭的完整網址。" />
      <Field label="備註">
        <textarea name="note" defaultValue={meeting?.note} rows={2} className={inputClass} />
      </Field>
      <SubmitButton className={submitClass}>{submitLabel}</SubmitButton>
    </form>
  );
}

function Links({ links, edit }: { links: CommitteeLink[]; edit: YearFields | null }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">重要連結</h2>
      <LinkList
        links={links}
        manage={
          edit &&
          ((link, index) => (
            <>
              <div className="flex flex-wrap gap-3">
                {index > 0 && <MoveButton edit={edit} id={link.id} direction="up" />}
                {index < links.length - 1 && <MoveButton edit={edit} id={link.id} direction="down" />}
              </div>
              <details>
                <summary className="cursor-pointer font-semibold">編輯連結</summary>
                <div className="mt-3">
                  <LinkForm edit={edit} link={link} submitLabel="儲存連結" />
                </div>
              </details>
              <DeleteForm edit={edit} kind="link" id={link.id} noun="連結" />
            </>
          ))
        }
      />
      {edit && (
        <AddDetails label="新增連結">
          <LinkForm edit={edit} submitLabel="新增連結" />
        </AddDetails>
      )}
    </section>
  );
}

function LinkForm({ edit, link, submitLabel }: { edit: YearFields; link?: CommitteeLink; submitLabel: string }) {
  return (
    <form action={saveLinkAction} className="flex flex-col gap-3">
      <YearInputs {...edit} />
      {link && <input type="hidden" name="id" value={link.id} />}
      <Field label="標題" required hint="例如：執行計畫。">
        <input name="title" defaultValue={link?.title} required className={inputClass} />
      </Field>
      <UrlField value={link?.url} hint="https:// 開頭的完整網址。" />
      <SubmitButton className={submitClass}>{submitLabel}</SubmitButton>
    </form>
  );
}

function MoveButton({ edit, id, direction }: { edit: YearFields; id: string; direction: "up" | "down" }) {
  return (
    <form action={moveLinkAction}>
      <YearInputs {...edit} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <SubmitButton className={cn(buttonVariants({ variant: "outline" }), buttonClass)}>
        {direction === "up" ? "↑ 往前移" : "↓ 往後移"}
      </SubmitButton>
    </form>
  );
}

function Team({ members, stakes, edit }: { members: TeamMember[]; stakes: DirectoryStake[]; edit: YearFields | null }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">工作團隊（{members.length} 人）</h2>
      <p>籌備會的執行組。和後台的工作人員帳號無關：名單上的課務組、報報組成員不會因此有後台帳號。</p>
      <TeamTable
        members={members}
        manage={
          edit &&
          ((member) => (
            <div className="flex flex-col gap-2">
              <details>
                <summary className="cursor-pointer font-semibold">編輯</summary>
                <div className="mt-3">
                  <TeamMemberForm edit={edit} stakes={stakes} member={member} submitLabel="儲存" />
                </div>
              </details>
              <DeleteForm edit={edit} kind="team_member" id={member.id} noun="這位" />
            </div>
          ))
        }
      />
      {edit && (
        <AddDetails label="新增工作團隊成員">
          <TeamMemberForm edit={edit} stakes={stakes} submitLabel="新增" />
        </AddDetails>
      )}
    </section>
  );
}

function TeamMemberForm({
  edit,
  stakes,
  member,
  submitLabel,
}: {
  edit: YearFields;
  stakes: DirectoryStake[];
  member?: TeamMember;
  submitLabel: string;
}) {
  return (
    <form action={saveTeamMemberAction} className="flex flex-col gap-3">
      <YearInputs {...edit} />
      {member && <input type="hidden" name="id" value={member.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="組別" required>
          <select name="team" defaultValue={member?.team ?? ""} required className={inputClass}>
            <option value="" disabled>
              請選擇
            </option>
            {COMMITTEE_TEAMS.map((team) => (
              <option key={team} value={team}>
                {COMMITTEE_TEAM_LABELS[team]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="職務" required>
          <select name="role" defaultValue={member?.role ?? ""} required className={inputClass}>
            <option value="" disabled>
              請選擇
            </option>
            <option value="lead">總召／組長</option>
            <option value="deputy">副總召／副組長</option>
          </select>
        </Field>
        <Field label="姓名" required>
          <input name="name" defaultValue={member?.name} required className={inputClass} />
        </Field>
        <Field label="區" hint="負責的範圍。">
          <select name="region" defaultValue={member?.region ?? ""} className={inputClass}>
            <option value="">全區</option>
            {REGIONS.map((region) => (
              <option key={region} value={region}>
                {REGION_LABELS[region]}
              </option>
            ))}
          </select>
        </Field>
        <StakeField stakes={stakes} value={member?.stakeId} />
      </div>
      <SubmitButton className={submitClass}>{submitLabel}</SubmitButton>
    </form>
  );
}

function Members({
  members,
  stakes,
  edit,
}: {
  members: CommitteeMember[];
  stakes: DirectoryStake[];
  edit: YearFields | null;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">籌備委員（{members.length} 人）</h2>
      <p>每個支聯會推兩位，其中一位須為慈助會會長團成員。依支聯會名單的順序排列。</p>
      <MemberTable
        members={members}
        manage={
          edit &&
          ((member) => (
            <div className="flex flex-col gap-2">
              <details>
                <summary className="cursor-pointer font-semibold">編輯</summary>
                <div className="mt-3">
                  <MemberForm edit={edit} stakes={stakes} member={member} submitLabel="儲存" />
                </div>
              </details>
              <DeleteForm edit={edit} kind="member" id={member.id} noun="這位" />
            </div>
          ))
        }
      />
      {edit && (
        <AddDetails label="新增籌備委員">
          <MemberForm edit={edit} stakes={stakes} submitLabel="新增" />
        </AddDetails>
      )}
    </section>
  );
}

function MemberForm({
  edit,
  stakes,
  member,
  submitLabel,
}: {
  edit: YearFields;
  stakes: DirectoryStake[];
  member?: CommitteeMember;
  submitLabel: string;
}) {
  return (
    <form action={saveMemberAction} className="flex flex-col gap-3">
      <YearInputs {...edit} />
      {member && <input type="hidden" name="id" value={member.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="姓名" required>
          <input name="name" defaultValue={member?.name} required className={inputClass} />
        </Field>
        <StakeField stakes={stakes} value={member?.stakeId} />
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          name="reliefSocietyPresidency"
          defaultChecked={member?.reliefSocietyPresidency}
          className="size-5"
        />
        <span className="font-semibold">是慈助會會長團成員</span>
      </label>
      <SubmitButton className={submitClass}>{submitLabel}</SubmitButton>
    </form>
  );
}

/** 支聯會選單：使用中的支聯會，加上原本選的（如果已經停用）。 */
function StakeField({ stakes, value }: { stakes: DirectoryStake[]; value?: string }) {
  return (
    <Field label="支聯會" required>
      <select name="stakeId" defaultValue={value ?? ""} required className={inputClass}>
        <option value="" disabled>
          請選擇
        </option>
        {stakes
          .filter((stake) => stake.isActive || stake.id === value)
          .map((stake) => (
            <option key={stake.id} value={stake.id}>
              {stake.nameZh}
              {stake.isActive ? "" : "（已停用）"}
            </option>
          ))}
      </select>
    </Field>
  );
}

function UrlField({ value, hint }: { value?: string; hint: string }) {
  return (
    <Field label="連結" required hint={hint}>
      <input name="url" type="url" defaultValue={value} required className={inputClass} />
    </Field>
  );
}

function YearInputs({ conferenceId, year }: YearFields) {
  return (
    <>
      <input type="hidden" name="conferenceId" value={conferenceId} />
      <input type="hidden" name="year" value={year} />
    </>
  );
}

function AddDetails({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className={cardClass}>
      <summary className="cursor-pointer text-lg font-bold">{label}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function DeleteForm({ edit, kind, id, noun }: { edit: YearFields; kind: CommitteeItemKind; id: string; noun: string }) {
  return (
    <details>
      <summary className="cursor-pointer font-semibold text-destructive">刪除</summary>
      <form action={deleteItemAction} className="mt-3 flex flex-col gap-2">
        <YearInputs {...edit} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <p>確定要刪除{noun}嗎？不能復原。</p>
        <SubmitButton
          className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}
        >
          確定刪除
        </SubmitButton>
      </form>
    </details>
  );
}

