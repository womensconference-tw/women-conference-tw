import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PATTERN, trimBlank } from "./registration";

/*
 * 後台工作人員（ADR 0004）：用 Email 魔法連結登入，帳號只能由總管理員新增。
 * 角色與負責範圍存在資料表 staff_members；寫入只能透過資料庫函式，由函式檢查是不是總管理員。
 */

/** 整理使用者輸入的 Email：去掉前後空白、轉小寫。格式不對時回傳 null。 */
export function normalizeEmail(raw: string): string | null {
  const email = trimBlank(raw).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

export type SignInLinkResult = { ok: true } | { ok: false; error: "email_invalid" | "unavailable" };

/**
 * 寄後台登入連結。只寄給已經有帳號的 Email，不會建立新帳號。
 * 沒有帳號時也回傳成功，畫面上看不出哪些 Email 是工作人員。
 * 信裡的連結指向 /staff/auth/confirm（見 supabase/templates/magic_link.html）。
 * 登入頁在回應送出後才呼叫（src/app/staff/actions.ts），回應快慢也看不出差別。
 */
export async function requestSignInLink(supabase: SupabaseClient, rawEmail: string): Promise<SignInLinkResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: "email_invalid" };

  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  // 沒有帳號時 Supabase 回 otp_disabled（不能用登入連結註冊）；當成成功，不透露。
  // 寄太頻繁（429）只會發生在有帳號的 Email，也當成成功，否則一按再按就看得出誰是工作人員。
  if (error?.status === 429) console.warn("後台登入連結寄太頻繁，這次沒寄", error.code);
  else if (error && error.code !== "otp_disabled" && error.code !== "signup_disabled") {
    console.error("寄後台登入連結失敗", error);
    return { ok: false, error: "unavailable" };
  }
  return { ok: true };
}

/**
 * 後台角色：總管理員（網站建置者與總召團）、課務組、報報組。與資料庫 staff_members_role_valid 用同一組代碼。
 * 課務組、報報組都只能看、不能改。
 */
export const STAFF_ROLES = ["admin", "course_team", "registration_team"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "總管理員",
  course_team: "課務組",
  registration_team: "報報組",
};

/** 區：場地、支聯會與工作人員的負責範圍。與資料庫的 *_region_valid 用同一組代碼。 */
export const REGIONS = ["north", "central", "south"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  north: "北區",
  central: "中區",
  south: "南區",
};

export type StaffMember = {
  userId: string;
  email: string;
  role: StaffRole;
  /** 負責的區；總管理員與全區的報報組為 null。 */
  region: Region | null;
};

export type StaffListItem = StaffMember & { createdAt: string; lastSignInAt: string | null };

/** 新增或修改工作人員時填的角色與負責範圍。 */
export type StaffScope = { role: StaffRole; region: Region | null };

export type StaffError =
  | "email_invalid"
  | "not_admin"
  | "scope_invalid"
  | "already_staff"
  | "last_admin"
  | "staff_not_found"
  | "unavailable";

export type StaffResult = { ok: true } | { ok: false; error: StaffError };

/** 用來建立、刪除登入帳號的連線（秘密金鑰）。資料庫裡沒辦法建帳號，所以由網站伺服器做。 */
type Clients = { session: SupabaseClient; authAdmin: SupabaseClient };

/** 目前登入的工作人員；沒登入、或有登入帳號但不在工作人員名單裡時回傳 null。 */
export async function getStaffMember(supabase: SupabaseClient): Promise<StaffMember | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("staff_members")
    .select("role, region")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return { userId: user.id, email: user.email ?? "", role: data.role, region: data.region };
}

/** 工作人員名單。只有總管理員能看，其他人會丟出錯誤。 */
export async function listStaffMembers(supabase: SupabaseClient): Promise<StaffListItem[]> {
  const { data, error } = await supabase.rpc("list_staff_members");
  if (error) throw error;
  return (data as StaffRow[]).map((row) => ({
    userId: row.user_id,
    email: row.email,
    role: row.role,
    region: row.region,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
  }));
}

type StaffRow = {
  user_id: string;
  email: string;
  role: StaffRole;
  region: Region | null;
  created_at: string;
  last_sign_in_at: string | null;
};

/**
 * 新增工作人員：先確認操作的人是總管理員，再建立登入帳號（已經有就沿用），最後加進工作人員名單。
 * 加入名單失敗時，把這次新建的登入帳號刪掉，不留下沒有角色的帳號。
 */
export async function addStaffMember(
  { session, authAdmin }: Clients,
  input: StaffScope & { email: string },
): Promise<StaffResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "email_invalid" };
  // 明顯不相符的先擋下，不必建了帳號再刪。
  if (!scopeShapeValid(input)) return { ok: false, error: "scope_invalid" };

  // 先擋下非總管理員，免得她們能透過這個動作建立登入帳號。
  const { data: isAdmin, error: adminError } = await session.rpc("is_staff_admin");
  if (adminError) return failure(adminError);
  if (!isAdmin) return { ok: false, error: "not_admin" };

  const created = await authAdmin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && created.error.code !== "email_exists") return failure(created.error);
  const createdUserId = created.data.user?.id ?? null;

  const { error } = await session.rpc("add_staff_member", {
    p_email: email,
    p_role: input.role,
    p_region: input.region,
  });
  // already_staff 時帳號屬於已經在名單裡的人（可能是另一位總管理員同時新增的），不能刪。
  if (error && createdUserId && error.message !== "already_staff") {
    const { error: deleteError } = await authAdmin.auth.admin.deleteUser(createdUserId);
    if (deleteError) console.error("新增工作人員失敗後刪除登入帳號也失敗，留下沒有角色的帳號", email, deleteError);
  }
  return error ? failure(error) : { ok: true };
}

// 與資料庫 check_staff_scope 同一套規則：總管理員不分區，課務組一定要有一區，報報組一區或全區。
function scopeShapeValid({ role, region }: StaffScope): boolean {
  if (region !== null && !REGIONS.includes(region)) return false;
  switch (role) {
    case "admin":
      return region === null;
    case "course_team":
      return region !== null;
    case "registration_team":
      return true;
    default:
      return false;
  }
}

/** 修改工作人員的角色與負責範圍。 */
export async function updateStaffMember(
  session: SupabaseClient,
  input: StaffScope & { userId: string },
): Promise<StaffResult> {
  const { error } = await session.rpc("update_staff_member", {
    p_user_id: input.userId,
    p_role: input.role,
    p_region: input.region,
  });
  return error ? failure(error) : { ok: true };
}

/**
 * 移除工作人員：先從名單移除（資料庫檢查權限與是否還有總管理員），再刪掉登入帳號。
 * 刪帳號失敗也不影響：不在名單裡就進不了後台。
 */
export async function removeStaffMember({ session, authAdmin }: Clients, userId: string): Promise<StaffResult> {
  const { error } = await session.rpc("remove_staff_member", { p_user_id: userId });
  if (error) return failure(error);

  const { error: deleteError } = await authAdmin.auth.admin.deleteUser(userId);
  if (deleteError) console.error("移除工作人員後刪除登入帳號失敗", deleteError);
  return { ok: true };
}

// 資料庫函式丟出的代碼直接轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
const DATABASE_ERRORS: StaffError[] = ["not_admin", "scope_invalid", "already_staff", "last_admin", "staff_not_found"];

function failure(error: { message: string }): { ok: false; error: StaffError } {
  const code = DATABASE_ERRORS.find((known) => error.message === known);
  if (code) return { ok: false, error: code };
  console.error("工作人員帳號操作失敗", error);
  return { ok: false, error: "unavailable" };
}
