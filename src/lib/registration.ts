import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * 報名服務：前台寫入報名的唯一入口。
 * 欄位檢查（validateRegistration）不碰資料庫，報名表在每一步也用它即時提示；
 * 要看資料庫當下狀態的規則（是否報名中、支會是否屬於該支聯會）由資料庫函式 submit_registration 檢查。
 */

/** 報名表送出的內容，都是使用者輸入的原樣，整理與檢查由報名服務負責。 */
export type RegistrationInput = {
  name: string;
  phone: string;
  /** 勾選「我沒有電話」：不填電話，由系統發報名編號。 */
  noPhone: boolean;
  email: string;
  lineId: string;
  stakeId: string;
  wardId: string;
  venueId: string;
  portraitConsent: boolean;
};

/** 錯誤顯示的位置：各欄位旁，或 form（整張表單上方）。 */
export type RegistrationField =
  | "name"
  | "phone"
  | "email"
  | "lineId"
  | "stake"
  | "ward"
  | "venue"
  | "portraitConsent"
  | "form";

export type RegistrationError =
  | "nameRequired"
  | "nameTooLong"
  | "phoneRequired"
  | "phoneInvalid"
  | "emailInvalid"
  | "lineIdTooLong"
  | "stakeRequired"
  | "wardRequired"
  | "wardNotInStake"
  | "venueRequired"
  | "portraitConsentRequired"
  | "notOpen"
  | "unknown";

export type RegistrationErrors = Partial<Record<RegistrationField, RegistrationError>>;

/** 存下的報名。 */
export type Registration = {
  id: string;
  name: string;
  /** 整理後的電話（只有數字，國際號碼可有開頭的 +）；沒有電話時是 null。 */
  phone: string | null;
  /** 沒有電話時系統發的 6 碼報名編號；有電話時是 null。 */
  registrationNumber: string | null;
  email: string | null;
  lineId: string | null;
  stakeId: string;
  wardId: string;
  venueId: string;
};

export type SubmitResult =
  | { ok: true; registration: Registration }
  | { ok: false; errors: RegistrationErrors };

const NAME_MAX_LENGTH = 50;
const LINE_ID_MAX_LENGTH = 50;
const PHONE_PATTERN = /^\+?\d{8,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 與資料庫產生的規則一致：100000–999999。
const REGISTRATION_NUMBER_PATTERN = /^[1-9]\d{5}$/;

/** 是否為系統會發的報名編號格式（6 碼數字、不以 0 開頭）。 */
export function isRegistrationNumber(value: string): boolean {
  return REGISTRATION_NUMBER_PATTERN.test(value);
}

/**
 * 把使用者輸入的電話整理成存檔與比對用的格式：全形轉半形，去掉空白、-、括號、點。
 * 例如「（02）2345-6789」→「0223456789」、「+886 912 345 678」→「+886912345678」。
 */
export function normalizePhone(raw: string): string {
  return raw
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-().]/g, "");
}

/** 檢查欄位格式，不碰資料庫。沒有錯誤時回傳空物件。 */
export function validateRegistration(input: RegistrationInput): RegistrationErrors {
  const errors: RegistrationErrors = {};

  const name = input.name.trim();
  if (!name) errors.name = "nameRequired";
  else if ([...name].length > NAME_MAX_LENGTH) errors.name = "nameTooLong";

  if (!input.noPhone) {
    const phone = normalizePhone(input.phone);
    if (!phone) errors.phone = "phoneRequired";
    else if (!PHONE_PATTERN.test(phone)) errors.phone = "phoneInvalid";
  }

  const email = input.email.trim();
  if (email && !EMAIL_PATTERN.test(email)) errors.email = "emailInvalid";

  if ([...input.lineId.trim()].length > LINE_ID_MAX_LENGTH) errors.lineId = "lineIdTooLong";

  if (!UUID_PATTERN.test(input.stakeId)) errors.stake = "stakeRequired";
  if (!UUID_PATTERN.test(input.wardId)) errors.ward = "wardRequired";
  if (!UUID_PATTERN.test(input.venueId)) errors.venue = "venueRequired";

  if (input.portraitConsent !== true) errors.portraitConsent = "portraitConsentRequired";

  return errors;
}

// submit_registration 丟出的代碼對應到哪個欄位的哪個錯誤。
const databaseErrors: Record<string, RegistrationErrors> = {
  registration_not_open: { form: "notOpen" },
  portrait_consent_required: { portraitConsent: "portraitConsentRequired" },
  // 場地或支聯會不在可選的名單中（例如剛被停用），請她重新選。
  venue_invalid: { venue: "venueRequired" },
  stake_invalid: { stake: "stakeRequired" },
  ward_not_in_stake: { ward: "wardNotInStake" },
};

/** 送出報名：檢查欄位，在報名中時寫入一筆與會姐妹的報名。 */
export async function submitRegistration(
  supabase: SupabaseClient,
  input: RegistrationInput,
): Promise<SubmitResult> {
  const errors = validateRegistration(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const { data, error } = await supabase
    .rpc("submit_registration", {
      p_venue_id: input.venueId,
      p_stake_id: input.stakeId,
      p_ward_id: input.wardId,
      p_name: input.name.trim(),
      p_phone: input.noPhone ? null : normalizePhone(input.phone),
      p_email: input.email.trim() || null,
      p_line_id: input.lineId.trim() || null,
      p_portrait_consent: input.portraitConsent,
    })
    .single<RegistrationRow>();
  if (error) {
    const known = databaseErrors[error.message];
    if (known) return { ok: false, errors: known };
    console.error("submit_registration failed", error);
    return { ok: false, errors: { form: "unknown" } };
  }

  return {
    ok: true,
    registration: {
      id: data.id,
      name: data.name,
      phone: data.phone,
      registrationNumber: data.registration_number,
      email: data.email,
      lineId: data.line_id,
      stakeId: data.stake_id,
      wardId: data.ward_id,
      venueId: data.venue_id,
    },
  };
}

type RegistrationRow = {
  id: string;
  name: string;
  phone: string | null;
  registration_number: string | null;
  email: string | null;
  line_id: string | null;
  stake_id: string;
  ward_id: string;
  venue_id: string;
};
