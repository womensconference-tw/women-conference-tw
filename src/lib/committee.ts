import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isSafeButtonUrl, validDate } from "./content";
import { trimBlank, UUID_PATTERN } from "./registration";
import { REGIONS, type Region } from "./staff";

/*
 * 籌備委員會資訊（#45）：大會簡介、主席的話、籌備委員會備忘錄、會議記錄、重要連結、工作團隊與籌備委員名單。
 * 屬於年度大會。三個文字頁先存成草稿，總管理員預覽確定後才發布（#76）；其他的存了就公開。只有總管理員能編輯，由資料庫的權限規則強制（ADR 0004）；這裡先確認一次，好在畫面上說明。
 * 目前與過去年度不用登入也讀得到（公開頁面 /committee，#74）；還沒到的年度只有工作人員讀得到。
 * 名單只是資訊，不給任何後台權限：工作團隊的課務組、報報組成員不會因此有後台帳號（GLOSSARY「工作團隊」）。
 */

export type CommitteeError =
  | "not_admin"
  | "title_required"
  | "name_required"
  | "date_invalid"
  | "url_invalid"
  | "team_invalid"
  | "role_invalid"
  | "region_invalid"
  | "stake_required"
  | "not_found"
  | "no_draft"
  | "draft_changed"
  | "unavailable";

export type CommitteeResult = { ok: true } | { ok: false; error: CommitteeError };
type SavedResult = { ok: true; id: string } | { ok: false; error: CommitteeError };

/** 工作團隊的組別，依名單上的順序。 */
export const COMMITTEE_TEAMS = [
  "conveners",
  "course",
  "onsite",
  "registration",
  "publicity",
  "public_relations",
  "secretariat",
] as const;
export type CommitteeTeam = (typeof COMMITTEE_TEAMS)[number];

export const COMMITTEE_TEAM_LABELS: Record<CommitteeTeam, string> = {
  conveners: "總召團",
  course: "課務組",
  onsite: "現場組",
  registration: "報報組",
  publicity: "文宣組",
  public_relations: "公關組",
  secretariat: "秘書組",
};

/** 職務，依名單上的順序：正職、副職。名稱依組別而定（roleLabel），不會有組別和職務對不上的情形。 */
export const COMMITTEE_ROLES = ["lead", "deputy"] as const;
export type CommitteeRole = (typeof COMMITTEE_ROLES)[number];

/** 總召團是總召、副總召，各組是組長、副組長。 */
export function roleLabel(team: CommitteeTeam, role: CommitteeRole): string {
  const conveners = team === "conveners";
  return role === "lead" ? (conveners ? "總召" : "組長") : conveners ? "副總召" : "副組長";
}

export type Meeting = { id: string; title: string; meetingDate: string; url: string; note: string };
export type CommitteeLink = { id: string; title: string; url: string };
export type TeamMember = {
  id: string;
  team: CommitteeTeam;
  role: CommitteeRole;
  name: string;
  /** 負責的區；空值是全區。 */
  region: Region | null;
  stakeId: string;
  stakeName: string;
};
export type CommitteeMember = {
  id: string;
  name: string;
  stakeId: string;
  stakeName: string;
  /** 支聯會的區。 */
  stakeRegion: Region | null;
  reliefSocietyPresidency: boolean;
};

export type Committee = {
  introduction: string;
  chairMessage: string;
  memorandum: string;
  /** 三個文字頁是不是 Markdown；改版前存的是純文字，總管理員用新的編輯框存過一次才是（#75）。 */
  markdown: boolean;
  /** 依日期，同一天依標題。 */
  meetings: Meeting[];
  /** 依總管理員排的順序。 */
  links: CommitteeLink[];
  /** 依組別與職務，同職務依姓名。 */
  teamMembers: TeamMember[];
  /** 依支聯會名單的順序（東到西、北到南），同支聯會依姓名。 */
  members: CommitteeMember[];
};

/**
 * 一個年度的籌備委員會資訊。目前與過去年度任何人都讀得到；還沒到的年度只有工作人員讀得到，其他人讀到的全是空的。
 */
export async function getCommittee(supabase: SupabaseClient, conferenceId: string): Promise<Committee> {
  const [texts, meetings, links, teamMembers, members, stakeRows] = await Promise.all([
    supabase
      .from("committee_texts")
      .select("introduction, chair_message, memorandum, markdown")
      .eq("conference_id", conferenceId)
      .maybeSingle(),
    supabase
      .from("committee_meetings")
      .select("id, title, meeting_date, url, note")
      .eq("conference_id", conferenceId)
      .order("meeting_date")
      .order("title")
      .order("id"),
    supabase
      .from("committee_links")
      .select("id, title, url")
      .eq("conference_id", conferenceId)
      .order("position")
      .order("id"),
    supabase
      .from("committee_team_members")
      .select("id, team, role, name, region, stake_id")
      .eq("conference_id", conferenceId)
      .order("name")
      .order("id"),
    supabase
      .from("committee_members")
      .select("id, name, stake_id, relief_society_presidency")
      .eq("conference_id", conferenceId)
      .order("name")
      .order("id"),
    // 名單用到的支聯會可能已經停用，前台訪客讀不到支聯會表裡停用的，改由資料庫函式讀（#74）。
    supabase.rpc("committee_stakes", { p_conference_id: conferenceId }),
  ]);
  for (const result of [texts, meetings, links, teamMembers, members, stakeRows]) {
    if (result.error) throw result.error;
  }
  const stakes = new Map(
    (stakeRows.data as { id: string; name_zh: string; region: string; position: number }[]).map((stake) => [stake.id, stake]),
  );

  // 組別與職務的順序不是字母順序，在這裡排；資料庫已經依姓名排好，sort 不會打亂同組同職務的順序。
  const teamOrder = (member: { team: CommitteeTeam; role: CommitteeRole }) =>
    COMMITTEE_TEAMS.indexOf(member.team) * COMMITTEE_ROLES.length + COMMITTEE_ROLES.indexOf(member.role);

  return {
    introduction: texts.data?.introduction ?? "",
    chairMessage: texts.data?.chair_message ?? "",
    memorandum: texts.data?.memorandum ?? "",
    markdown: texts.data?.markdown ?? true,
    meetings: meetings.data!.map((row) => ({
      id: row.id,
      title: row.title,
      meetingDate: row.meeting_date,
      url: row.url,
      note: row.note,
    })),
    links: links.data!,
    teamMembers: teamMembers
      .data!.map((row) => ({
        id: row.id,
        team: row.team as CommitteeTeam,
        role: row.role as CommitteeRole,
        name: row.name,
        region: row.region as Region | null,
        stakeId: row.stake_id,
        stakeName: stakes.get(row.stake_id)?.name_zh ?? "",
      }))
      .sort((a, b) => teamOrder(a) - teamOrder(b)),
    members: members
      .data!.map((row) => ({ row, stakePosition: stakes.get(row.stake_id)?.position ?? 0 }))
      // 支聯會排序相同時依編號，和支聯會名單一樣。
      .sort(
        (a, b) =>
          a.stakePosition - b.stakePosition ||
          (a.row.stake_id === b.row.stake_id ? 0 : a.row.stake_id < b.row.stake_id ? -1 : 1),
      )
      .map(({ row }) => ({
        id: row.id,
        name: row.name,
        stakeId: row.stake_id,
        stakeName: stakes.get(row.stake_id)?.name_zh ?? "",
        stakeRegion: (stakes.get(row.stake_id)?.region ?? null) as Region | null,
        reliefSocietyPresidency: row.relief_society_presidency,
      })),
  };
}

/** 公開頁面的一個年度。 */
export type PublicCommitteeYear = { id: string; year: number; isCurrent: boolean };

/** 籌備委員會資訊公開的年度（目前與過去年度），新的在前。不用登入也讀得到。 */
export async function listPublicCommitteeYears(supabase: SupabaseClient): Promise<PublicCommitteeYear[]> {
  const { data, error } = await supabase.rpc("list_public_committee_years");
  if (error) throw error;
  return (data as { id: string; year: number; is_current: boolean }[]).map((row) => ({
    id: row.id,
    year: row.year,
    isCurrent: row.is_current,
  }));
}

export type CommitteeTextsInput = {
  conferenceId: string;
  introduction: string;
  chairMessage: string;
  memorandum: string;
};

/** 三個文字頁的欄位，依頁面上的順序。 */
export const COMMITTEE_TEXT_KEYS = ["introduction", "chairMessage", "memorandum"] as const;
export type CommitteeTextKey = (typeof COMMITTEE_TEXT_KEYS)[number];

/** 三個文字頁還沒發布的草稿（#76）。只有總管理員讀得到。 */
export type CommitteeTextDraft = Record<CommitteeTextKey, string> & {
  /** 這份草稿的版本代號，每次存草稿都換。發布時帶上預覽時看到的代號，確認發布的就是預覽過的那一版。 */
  revision: string;
  /** 最後存草稿的時間。 */
  updatedAt: string;
};

/** 一個年度三個文字頁的草稿；沒有草稿、或不是總管理員時是 null。 */
export async function getCommitteeTextDraft(
  supabase: SupabaseClient,
  conferenceId: string,
): Promise<CommitteeTextDraft | null> {
  if (!validIds(conferenceId)) return null;
  const { data, error } = await supabase
    .from("committee_text_drafts")
    .select("introduction, chair_message, memorandum, revision, updated_at")
    .eq("conference_id", conferenceId)
    .maybeSingle();
  // 前台訪客連讀取的權限都沒有；課務組、報報組被權限規則擋下，讀到的是空的。
  if (error?.code === "42501") return null;
  if (error) throw error;
  return (
    data && {
      introduction: data.introduction,
      chairMessage: data.chair_message,
      memorandum: data.memorandum,
      revision: data.revision,
      updatedAt: data.updated_at,
    }
  );
}

/**
 * 草稿裡和已發布的版本不同的頁面，依頁面上的順序。沒有草稿時是空的。
 * 已發布的還是改版前的純文字時，發布後改依樣式排版，有內容的頁面文字沒改也會變樣，一樣算有修改（#75）。
 */
export function changedTextPages(
  published: Record<CommitteeTextKey, string> & { markdown: boolean },
  draft: Record<CommitteeTextKey, string> | null,
): CommitteeTextKey[] {
  if (!draft) return [];
  return COMMITTEE_TEXT_KEYS.filter((key) => draft[key] !== published[key] || (!published.markdown && draft[key] !== ""));
}

/**
 * 把三個文字頁（大會簡介、主席的話、籌備委員會備忘錄）存成草稿；公開頁面與其他工作人員看到的仍是已發布的版本。
 * 傳回這份草稿的版本代號。
 */
export async function saveCommitteeTextDraft(
  supabase: SupabaseClient,
  input: CommitteeTextsInput,
): Promise<{ ok: true; revision: string } | { ok: false; error: CommitteeError }> {
  if (!validIds(input.conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = await supabase.rpc("save_committee_text_draft", {
    p_conference_id: input.conferenceId,
    p_introduction: trimBlank(input.introduction),
    p_chair_message: trimBlank(input.chairMessage),
    p_memorandum: trimBlank(input.memorandum),
  });
  return error ? failure(error) : { ok: true, revision: data as string };
}

/**
 * 發布草稿：草稿變成正式版本，大家立即看到。revision 是預覽時看到的草稿版本代號；
 * 預覽之後草稿又被存過（例如另一位總管理員）就不發布（draft_changed），請她重新預覽。
 */
export async function publishCommitteeTexts(
  supabase: SupabaseClient,
  conferenceId: string,
  revision: string,
): Promise<CommitteeResult> {
  if (!validIds(conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;
  // 表單送來的代號格式不對（網頁被改過），一定不是現在的草稿。
  if (!UUID_PATTERN.test(revision)) return { ok: false, error: "draft_changed" };

  const { error } = await supabase.rpc("publish_committee_texts", { p_conference_id: conferenceId, p_revision: revision });
  return error ? failure(error) : { ok: true };
}

/** 捨棄草稿，回到已發布的版本。沒有草稿時也算成功（可能另一位總管理員剛捨棄或發布了）。 */
export async function discardCommitteeTextDraft(supabase: SupabaseClient, conferenceId: string): Promise<CommitteeResult> {
  if (!validIds(conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("discard_committee_text_draft", { p_conference_id: conferenceId });
  return error ? failure(error) : { ok: true };
}

export type MeetingInput = {
  /** 有就是修改，沒有就是新增。 */
  id?: string | null;
  conferenceId: string;
  title: string;
  /** YYYY-MM-DD。 */
  meetingDate: string;
  url: string;
  note: string;
};

/** 新增或修改一筆會議記錄。 */
export async function saveMeeting(supabase: SupabaseClient, input: MeetingInput): Promise<SavedResult> {
  const title = trimBlank(input.title);
  if (!title) return { ok: false, error: "title_required" };
  const meetingDate = trimBlank(input.meetingDate);
  if (!validDate(meetingDate)) return { ok: false, error: "date_invalid" };
  const url = trimBlank(input.url);
  if (!isSafeExternalUrl(url)) return { ok: false, error: "url_invalid" };

  return saveRow(supabase, "committee_meetings", input, { title, meeting_date: meetingDate, url, note: trimBlank(input.note) });
}

export type CommitteeLinkInput = { id?: string | null; conferenceId: string; title: string; url: string };

/** 新增或修改一個重要連結。新的排在最後。 */
export async function saveCommitteeLink(supabase: SupabaseClient, input: CommitteeLinkInput): Promise<SavedResult> {
  const title = trimBlank(input.title);
  if (!title) return { ok: false, error: "title_required" };
  const url = trimBlank(input.url);
  if (!isSafeExternalUrl(url)) return { ok: false, error: "url_invalid" };

  return saveRow(supabase, "committee_links", input, { title, url }, async () => {
    // 新的排在最後。兩位總管理員同時新增時排序數字可能相同，顯示時依編號，移動時會重新編號。
    const { data, error } = await supabase
      .from("committee_links")
      .select("position")
      .eq("conference_id", input.conferenceId)
      .order("position", { ascending: false })
      .limit(1);
    if (error) throw error;
    return { position: (data[0]?.position ?? 0) + 1 };
  });
}

export type TeamMemberInput = {
  id?: string | null;
  conferenceId: string;
  /** 表單上的原始值。 */
  team: string;
  role: string;
  name: string;
  /** 空白是全區。 */
  region: string | null;
  stakeId: string;
};

/** 新增或修改工作團隊名單上的一位。 */
export async function saveTeamMember(supabase: SupabaseClient, input: TeamMemberInput): Promise<SavedResult> {
  const name = trimBlank(input.name);
  if (!name) return { ok: false, error: "name_required" };
  if (!(COMMITTEE_TEAMS as readonly string[]).includes(input.team)) return { ok: false, error: "team_invalid" };
  const team = input.team as CommitteeTeam;
  if (!(COMMITTEE_ROLES as readonly string[]).includes(input.role)) return { ok: false, error: "role_invalid" };
  const region = input.region || null;
  if (region !== null && !(REGIONS as readonly string[]).includes(region)) return { ok: false, error: "region_invalid" };
  if (!input.stakeId) return { ok: false, error: "stake_required" };

  return saveRow(supabase, "committee_team_members", input, {
    team,
    role: input.role,
    name,
    region,
    stake_id: input.stakeId,
  });
}

export type CommitteeMemberInput = {
  id?: string | null;
  conferenceId: string;
  name: string;
  stakeId: string;
  reliefSocietyPresidency: boolean;
};

/** 新增或修改一位籌備委員。 */
export async function saveCommitteeMember(supabase: SupabaseClient, input: CommitteeMemberInput): Promise<SavedResult> {
  const name = trimBlank(input.name);
  if (!name) return { ok: false, error: "name_required" };
  if (!input.stakeId) return { ok: false, error: "stake_required" };

  return saveRow(supabase, "committee_members", input, {
    name,
    stake_id: input.stakeId,
    relief_society_presidency: input.reliefSocietyPresidency,
  });
}

/** 可以刪除的項目。 */
export const COMMITTEE_ITEM_KINDS = ["meeting", "link", "team_member", "member"] as const;
export type CommitteeItemKind = (typeof COMMITTEE_ITEM_KINDS)[number];

const TABLES: Record<CommitteeItemKind, string> = {
  meeting: "committee_meetings",
  link: "committee_links",
  team_member: "committee_team_members",
  member: "committee_members",
};

/** 刪除一筆會議記錄、重要連結、工作團隊或籌備委員。 */
export async function deleteCommitteeItem(
  supabase: SupabaseClient,
  kind: CommitteeItemKind,
  id: string,
): Promise<CommitteeResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = await supabase.from(TABLES[kind]).delete().eq("id", id).select("id");
  if (error) return failure(error);
  return data.length === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/** 把一個重要連結往前或往後移一格；已經在最前或最後時不動。 */
export async function moveCommitteeLink(
  supabase: SupabaseClient,
  id: string,
  direction: "up" | "down",
): Promise<CommitteeResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("move_committee_link", { p_id: id, p_up: direction === "up" });
  return error ? failure(error) : { ok: true };
}

/**
 * 有網域的 http(s) 網址，不能有空白或控制字元。和資料庫的 is_safe_external_url 一致。
 * 網域前可以有帳號（user@），網域不能是空的，網域後只能接數字的連接埠，再來是 /、?、# 或結束：
 * https://@/、https://user@/、https://example.com:abc/ 這種打不開的連結不收。
 */
export function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\/([^/\\?#@]*@)?[^/\\?#@:]+(:[0-9]{1,5})?([/?#]|$)/i.test(url) && isSafeButtonUrl(url);
}

// 新增（沒有 id）或修改一列。修改時不能換年度（資料庫也沒給權限），所以只依 id 找。
async function saveRow(
  supabase: SupabaseClient,
  table: string,
  input: { id?: string | null; conferenceId: string },
  values: Record<string, unknown>,
  insertOnly?: () => Promise<Record<string, unknown>>,
): Promise<SavedResult> {
  if (!validIds(input.id, input.conferenceId)) return { ok: false, error: "not_found" };
  if (values.stake_id !== undefined && !validIds(values.stake_id as string)) return { ok: false, error: "stake_required" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = input.id
    ? await supabase
        .from(table)
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("id", input.id)
        .select("id")
    : await supabase
        .from(table)
        .insert({ ...values, ...(await insertOnly?.()), conference_id: input.conferenceId })
        .select("id");
  if (error) return failure(error);
  return data.length === 0 ? { ok: false, error: "not_found" } : { ok: true, id: data[0].id };
}

// 表單送來的編號格式不對（網頁被改過、或是很舊的頁面），當成找不到，不必交給資料庫。空的不算。
function validIds(...ids: (string | null | undefined)[]): boolean {
  return ids.every((id) => !id || UUID_PATTERN.test(id));
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下（修改、刪除時只是找不到資料），先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: CommitteeError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: CommitteeError } {
  const violates = (constraint: string) => error.code === "23514" && error.message.includes(constraint);
  switch (true) {
    case violates("title_not_blank"):
      return { ok: false, error: "title_required" };
    case violates("name_not_blank"):
      return { ok: false, error: "name_required" };
    case violates("url_safe"):
      return { ok: false, error: "url_invalid" };
    case violates("committee_team_members_team_valid"):
      return { ok: false, error: "team_invalid" };
    case violates("committee_team_members_role_valid"):
      return { ok: false, error: "role_invalid" };
    case violates("committee_team_members_region_valid"):
      return { ok: false, error: "region_invalid" };
    // 支聯會被刪掉了。
    case error.code === "23503" && error.message.includes("stake_id"):
      return { ok: false, error: "stake_required" };
    // 年度被刪掉了。
    case error.code === "23503":
    case error.message === "not_found":
      return { ok: false, error: "not_found" };
    case error.message === "no_draft":
      return { ok: false, error: "no_draft" };
    case error.message === "draft_changed":
      return { ok: false, error: "draft_changed" };
    case error.message === "not_admin":
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("編輯籌備委員會資訊失敗", error);
  return { ok: false, error: "unavailable" };
}
