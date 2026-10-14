import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "./i18n/locale";
import { localized } from "./i18n/localized";

/*
 * 報名服務：前台寫入報名的唯一入口。
 * 欄位檢查（validateRegistration）不碰資料庫，報名表在每一步也用它即時提示；
 * 要看資料庫當下狀態的規則（是否報名中、支會是否屬於該支聯會、課程與午餐等名額）由資料庫函式 submit_registration 檢查。
 * 查詢（lookupRegistration）是前台唯一能讀取報名的地方，由資料庫函式 lookup_registration 比對。
 * 修改（updateRegistration）由資料庫函式 update_registration 再比對一次姓名與電話（或報名編號），和送出走同一套名額檢查。
 * 取消（cancelRegistration）由資料庫函式 cancel_registration 同樣再比對一次，標記為已取消、不刪除。
 */

/** 即席唱詩班的聲部。與資料庫 registrations_choir_part_valid 用同一組代碼。 */
export const CHOIR_PARTS = ["soprano", "alto"] as const;
export type ChoirPart = (typeof CHOIR_PARTS)[number];

/**
 * 唱詩班以外的服務意願：前一天準備、中翻英翻譯、當天接待、活動後復原。
 * 與資料庫 registrations_services_valid 用同一組代碼；報名表依這個順序列出。
 */
export const SERVICES = ["setup", "translation", "reception", "cleanup"] as const;
export type Service = (typeof SERVICES)[number];

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
  /** 所選的課程，每個場次最多一門；沒有課程的場次就是「不選課」。 */
  courseIds: string[];
  /** 所選場地的午餐；null 表示「不需要」。 */
  lunchOptionId: string | null;
  /** 所選場地的午后動態；null 表示不參加。 */
  afternoonActivityId: string | null;
  /** 即席唱詩班的聲部（CHOIR_PARTS）；null 表示不參加唱詩班。 */
  choirPart: string | null;
  /** 其他服務意願（SERVICES）。 */
  services: string[];
  /** 要不要領取紙本手冊；null 表示還沒選，送出時會被擋下。 */
  printedHandbook: boolean | null;
  portraitConsent: boolean;
};

/**
 * 修改報名時可以改的部分：聯絡資料（電話、Email、LINE ID）與場地以後的每一步。
 * 姓名、支聯會、支會不能改，肖像權已經同意過；有沒有電話在報名時就決定了，noPhone 要和原本的一樣。
 */
export type RegistrationChanges = Omit<RegistrationInput, "name" | "stakeId" | "wardId" | "portraitConsent">;

/** 報名表內容裡修改時會送出的部分；姓名、支聯會、支會、肖像權同意不送。 */
export function changesOf(input: RegistrationInput): RegistrationChanges {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { name, stakeId, wardId, portraitConsent, ...changes } = input;
  return changes;
}

/** 錯誤顯示的位置：各欄位旁，或 form（整張表單上方）。 */
export type RegistrationField =
  | "name"
  | "phone"
  | "email"
  | "lineId"
  | "stake"
  | "ward"
  | "venue"
  | "courses"
  | "lunch"
  | "afternoonActivity"
  | "services"
  | "printedHandbook"
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
  | "stakeUnavailable"
  | "wardRequired"
  | "wardUnavailable"
  | "venueRequired"
  | "venueUnavailable"
  | "courseRequired"
  /** 成對課程只選了其中一堂。 */
  | "coursePairRequired"
  | "courseFull"
  | "lunchRequired"
  | "lunchUnavailable"
  | "lunchFull"
  | "afternoonActivityRequired"
  | "afternoonActivityUnavailable"
  | "afternoonActivityFull"
  | "servicesInvalid"
  | "printedHandbookRequired"
  | "portraitConsentRequired"
  | "notOpen"
  /** 修改時找不到這筆報名：姓名、電話不符，或剛被取消。 */
  | "notFound"
  /** 修改時同一個姓名猜錯太多次，和查詢一起暫停一陣子。 */
  | "tooManyAttempts"
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
  courseIds: string[];
  lunchOptionId: string | null;
  afternoonActivityId: string | null;
  choirPart: ChoirPart | null;
  services: Service[];
  printedHandbook: boolean;
};

export type SubmitResult =
  | { ok: true; registration: Registration }
  /** 送出時有課程、午餐或午后動態額滿，fullIds 列出是哪幾項。 */
  | { ok: false; errors: RegistrationErrors; fullIds?: string[] };

/** 成對課程的另一堂：在哪個場次、是哪門課。 */
export type PairedCourse = { sessionId: string; courseId: string };

/** 選課檢查需要的場次資料：每個場次開了哪些課，成對課程帶著另一堂。 */
export type SessionCourses = { id: string; courses: { id: string; pairedWith?: PairedCourse | null }[] };

// Postgres 偵測到互相等待時的錯誤代碼。
const DEADLOCK_DETECTED = "40P01";
const NAME_MAX_LENGTH = 50;
const LINE_ID_MAX_LENGTH = 50;
const PHONE_PATTERN = /^\+?\d{8,15}$/;
// 空白字元：包括手機輸入法可能帶進來、看不見的 U+0085、U+FEFF、全形空白。
// 必須與資料庫 public.trim_blank 和 registrations 的限制用同一組，兩邊判斷才會一致。
const BLANK = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const EDGE_BLANKS = new RegExp(`^[${BLANK}]+|[${BLANK}]+$`, "g");
const EMAIL_PATTERN = new RegExp(`^[^@${BLANK}]+@[^@${BLANK}]+\\.[^@${BLANK}]+$`);

/** 去掉前後的空白字元（規則見 BLANK）。 */
export function trimBlank(value: string): string {
  return value.replace(EDGE_BLANKS, "");
}
// 一個場地的場次不會超過這個數；送來更多的不必交給資料庫逐一檢查。
const MAX_COURSES = 20;
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
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(new RegExp(`[${BLANK}\\-().]`, "g"), "");
}

/**
 * 把送來的報名表內容整理成 RegistrationInput。報名、修改的伺服器動作任何人都能直接打，
 * 送來的不一定是報名表的形狀；型別不對的一律當成空白，交給欄位檢查擋下。
 */
export function registrationInputFrom(input: unknown): RegistrationInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  // 單選的午餐等：null 是「不需要」；其他不是字串的換成空字串，交給欄位檢查擋下。
  const choice = (key: string) => (raw[key] === null || raw[key] === undefined ? null : text(key));
  // 不是字串的項目換成空字串，交給欄位檢查擋下。
  const items = (key: string) =>
    (raw[key] as unknown[]).map((item) => (typeof item === "string" ? item : ""));
  return {
    name: text("name"),
    phone: text("phone"),
    noPhone: raw.noPhone === true,
    email: text("email"),
    lineId: text("lineId"),
    stakeId: text("stakeId"),
    wardId: text("wardId"),
    venueId: text("venueId"),
    courseIds: Array.isArray(raw.courseIds) ? items("courseIds") : [],
    lunchOptionId: choice("lunchOptionId"),
    afternoonActivityId: choice("afternoonActivityId"),
    choirPart: choice("choirPart"),
    // 服務意願不是清單時，換成一個空字串，交給欄位檢查擋下，不默默當成沒有服務意願。
    services: Array.isArray(raw.services) ? items("services") : [""],
    // 不是 true 或 false 就當成還沒選，交給欄位檢查擋下，不默默當成不要。
    printedHandbook: typeof raw.printedHandbook === "boolean" ? raw.printedHandbook : null,
    portraitConsent: raw.portraitConsent === true,
  };
}

/**
 * 送出或修改之後，頁面上的選項是否要重新讀取。已填的資料留在瀏覽器裡，不受影響。
 * 失敗時：她選的場地、支聯會、支會、午餐、午后動態已不能選，或課程、午餐、午后動態剛額滿、有變動，
 * 回到那一步時才會顯示最新的名單。
 * 成功時：課程可能剛被移到別的場次，完成頁才會用最新的場次顯示她的課；名額也變了。
 */
export function optionsMayHaveChanged(result: SubmitResult): boolean {
  return (
    result.ok ||
    (["venue", "stake", "ward", "courses", "lunch", "afternoonActivity"] as const).some(
      (field) => result.errors[field],
    )
  );
}

/** 檢查欄位格式，不碰資料庫。沒有錯誤時回傳空物件。 */
export function validateRegistration(input: RegistrationInput): RegistrationErrors {
  const errors: RegistrationErrors = {};

  const name = trimBlank(input.name);
  if (!name) errors.name = "nameRequired";
  else if ([...name].length > NAME_MAX_LENGTH) errors.name = "nameTooLong";

  Object.assign(errors, validateChanges(input));

  if (!UUID_PATTERN.test(input.stakeId)) errors.stake = "stakeRequired";
  if (!UUID_PATTERN.test(input.wardId)) errors.ward = "wardRequired";

  if (input.portraitConsent !== true) errors.portraitConsent = "portraitConsentRequired";

  return errors;
}

/** 報名與修改共同的欄位檢查：聯絡資料與場地以後的每一步。 */
function validateChanges(input: RegistrationChanges): RegistrationErrors {
  const errors: RegistrationErrors = {};

  if (!input.noPhone) {
    const phone = normalizePhone(input.phone);
    if (!phone) errors.phone = "phoneRequired";
    else if (!PHONE_PATTERN.test(phone)) errors.phone = "phoneInvalid";
  }

  const email = trimBlank(input.email);
  if (email && !EMAIL_PATTERN.test(email)) errors.email = "emailInvalid";

  if ([...trimBlank(input.lineId)].length > LINE_ID_MAX_LENGTH) errors.lineId = "lineIdTooLong";

  if (!UUID_PATTERN.test(input.venueId)) errors.venue = "venueRequired";

  if (input.courseIds.length > MAX_COURSES || !input.courseIds.every((id) => UUID_PATTERN.test(id))) {
    errors.courses = "courseRequired";
  }

  if (input.lunchOptionId !== null && !UUID_PATTERN.test(input.lunchOptionId)) {
    errors.lunch = "lunchUnavailable";
  }
  if (input.afternoonActivityId !== null && !UUID_PATTERN.test(input.afternoonActivityId)) {
    errors.afternoonActivity = "afternoonActivityUnavailable";
  }

  if (
    (input.choirPart !== null && !(CHOIR_PARTS as readonly string[]).includes(input.choirPart)) ||
    !input.services.every((service) => (SERVICES as readonly string[]).includes(service))
  ) {
    errors.services = "servicesInvalid";
  }

  if (input.printedHandbook === null) errors.printedHandbook = "printedHandbookRequired";

  return errors;
}

/**
 * 報名表上每個場次的選擇：課程 id，或 null 表示「不選課」；沒有這個場次的鍵表示還沒選。
 * 「不選課」只是畫面上的選擇，不存；送出的 courseIds 由這裡的課程算出。
 */
export type CourseChoices = Record<string, string | null>;

/** 送出用的課程：選了課的場次各一門。 */
export function courseIdsOf(choices: CourseChoices): string[] {
  return Object.values(choices).filter((id): id is string => id !== null);
}

/**
 * 選課步驟的檢查：每個有開課的場次，選了這個場次的一門課，或明確選了「不選課」，免得她漏看一個場次。
 * 送出時資料庫只擋同一場次選兩門，不檢查有沒有漏選，因為沒存課程的場次就是不選課。
 */
export function validateCourseChoices(
  choices: CourseChoices,
  sessions: SessionCourses[],
): RegistrationErrors {
  const answered = sessions.every((session) => {
    if (session.courses.length === 0) return true;
    if (!Object.hasOwn(choices, session.id)) return false;
    const choice = choices[session.id];
    return choice === null || session.courses.some((course) => course.id === choice);
  });
  if (!answered) return { courses: "courseRequired" };
  // 成對課程兩堂都要選；只選到其中一堂，送出時資料庫也會擋下。
  const halfPair = courseIdsOf(choices).some((id) => {
    const partner = partnerOf(sessions, id);
    return partner && choices[partner.sessionId] !== partner.courseId;
  });
  return halfPair ? { courses: "coursePairRequired" } : {};
}

/** 某門課成對的另一堂；不是成對課程，或不在這些場次裡時是 undefined。 */
export function partnerOf(sessions: SessionCourses[], courseId: string): PairedCourse | undefined {
  return (
    sessions.flatMap((session) => session.courses).find((course) => course.id === courseId)?.pairedWith ??
    undefined
  );
}

/**
 * 選某個場次的課；courseId 是 null 表示這個場次不選課。同一場次只有一個選擇，換掉原本的。
 * 成對課程一起選、一起取消：選了其中一堂，另一堂的場次自動選另一堂；
 * 換掉成對課程的其中一堂（包括被自動選的那堂換掉），另一堂的場次清空，請她重選。
 */
export function chooseCourse(
  choices: CourseChoices,
  sessions: SessionCourses[],
  sessionId: string,
  courseId: string | null,
): CourseChoices {
  const next = { ...choices };
  const set = (session: string, course: string | null) => {
    const previous = next[session];
    next[session] = course;
    if (!previous || previous === course) return;
    const partner = partnerOf(sessions, previous);
    if (partner && next[partner.sessionId] === partner.courseId) delete next[partner.sessionId];
  };
  set(sessionId, courseId);
  const partner = courseId === null ? undefined : partnerOf(sessions, courseId);
  if (partner) set(partner.sessionId, partner.courseId);
  return next;
}

/**
 * 報名表上午餐、午后動態、紙本手冊的選擇；沒有這個鍵表示還沒選。
 * 午餐、午后動態的 null 是明確選了「不需要」「不參加」。送出的值由 extraInputOf 算出。
 */
export type ExtraChoices = {
  lunch?: string | null;
  afternoonActivity?: string | null;
  printedHandbook?: boolean;
};

/** 檢查午餐等選擇需要的場地資料：這個場地有哪些午餐與午后動態。 */
export type VenueExtras = { lunchOptions: { id: string }[]; afternoonActivities: { id: string }[] };

/** 送出用的午餐、午后動態、紙本手冊。還沒選的午餐、午后動態當成不需要；手冊沒選是 null，送出時會被擋下。 */
export function extraInputOf(
  choices: ExtraChoices,
): Pick<RegistrationInput, "lunchOptionId" | "afternoonActivityId" | "printedHandbook"> {
  return {
    lunchOptionId: choices.lunch ?? null,
    afternoonActivityId: choices.afternoonActivity ?? null,
    printedHandbook: choices.printedHandbook ?? null,
  };
}

/**
 * 午餐與服務步驟的檢查：場地有午餐時要選一份或「不需要」，有午后動態時要選一個或「不參加」，
 * 紙本手冊要選要或不要，免得她漏看。選的午餐、午后動態已不在這個場地（換了場地或被刪除）時，也要重選。
 */
export function validateExtraChoices(choices: ExtraChoices, venue: VenueExtras): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const answered = (choice: string | null | undefined, options: { id: string }[]) =>
    options.length === 0 ||
    choice === null ||
    (choice !== undefined && options.some((option) => option.id === choice));
  if (!answered(choices.lunch, venue.lunchOptions)) errors.lunch = "lunchRequired";
  if (!answered(choices.afternoonActivity, venue.afternoonActivities)) {
    errors.afternoonActivity = "afternoonActivityRequired";
  }
  if (choices.printedHandbook === undefined) errors.printedHandbook = "printedHandbookRequired";
  return errors;
}

/** 報名表上課程與午餐等的選擇。 */
export type FormChoices = { courses: CourseChoices; extras: ExtraChoices };

/**
 * 修改報名時，報名表一開始的選擇：每個有開課的場次是她選的課，沒存課程的場次是「不選課」；
 * 午餐、午后動態、紙本手冊照她存下的（null 是「不需要」「不參加」）。
 */
export function choicesOf(
  registration: Pick<Registration, "courseIds" | "lunchOptionId" | "afternoonActivityId" | "printedHandbook">,
  venue: { sessions: SessionCourses[] } | undefined,
): FormChoices {
  const courses: CourseChoices = {};
  for (const session of venue?.sessions ?? []) {
    if (session.courses.length === 0) continue;
    courses[session.id] =
      session.courses.find((course) => registration.courseIds.includes(course.id))?.id ?? null;
  }
  return {
    courses,
    extras: {
      lunch: registration.lunchOptionId,
      afternoonActivity: registration.afternoonActivityId,
      printedHandbook: registration.printedHandbook,
    },
  };
}

/** 換場地後的選擇：課程、午餐、午后動態屬於場地，全部清空要她重選；紙本手冊不受影響。 */
export function choicesAfterVenueChange(choices: FormChoices): FormChoices {
  return { courses: {}, extras: { printedHandbook: choices.extras.printedHandbook } };
}

// submit_registration 丟出的代碼對應到哪個欄位的哪個錯誤。
const databaseErrors: Record<string, RegistrationErrors> = {
  registration_not_open: { form: "notOpen" },
  portrait_consent_required: { portraitConsent: "portraitConsentRequired" },
  // 場地、支聯會、支會不在可選的名單中（例如她填表時剛被停用或刪除），請她重新選。
  venue_invalid: { venue: "venueUnavailable" },
  stake_invalid: { stake: "stakeUnavailable" },
  ward_not_in_stake: { ward: "wardUnavailable" },
  // 課程不在所選場地，或同一場次選了兩門：請她回選課步驟重新選。
  courses_invalid: { courses: "courseRequired" },
  // 成對課程只選了其中一堂。
  course_pair_incomplete: { courses: "coursePairRequired" },
  // 午餐、午后動態不在所選場地（例如她填表時剛被刪除）：請她重新選。
  lunch_invalid: { lunch: "lunchUnavailable" },
  afternoon_activity_invalid: { afternoonActivity: "afternoonActivityUnavailable" },
  // 以下只有修改時會出現：同一個姓名猜錯太多次，或想改掉有沒有電話。
  // 找不到她的報名（姓名、電話不符或已取消）時，修改函式回傳空值，不丟出代碼（見 saved）。
  too_many_attempts: { form: "tooManyAttempts" },
  phone_invalid: { phone: "phoneInvalid" },
};

// 欄位檢查與資料表限制本來就一致；萬一資料表擋下了，也標在對應的欄位旁，不只顯示「系統出了問題」。
const constraintErrors: Record<string, RegistrationErrors> = {
  registrations_name_valid: { name: "nameRequired" },
  registrations_phone_format: { phone: "phoneInvalid" },
  registrations_email_format: { email: "emailInvalid" },
  registrations_line_id_length: { lineId: "lineIdTooLong" },
  registrations_choir_part_valid: { services: "servicesInvalid" },
  registrations_services_valid: { services: "servicesInvalid" },
};

function violatedConstraint(message: string): string {
  return /violates check constraint "([^"]+)"/.exec(message)?.[1] ?? "";
}

/** 送出報名：檢查欄位，在報名中時寫入一筆與會姐妹的報名。 */
export async function submitRegistration(
  supabase: SupabaseClient,
  input: RegistrationInput,
): Promise<SubmitResult> {
  const errors = validateRegistration(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return saved(
    "submit_registration",
    () =>
      supabase
        .rpc("submit_registration", {
          p_venue_id: input.venueId,
          p_stake_id: input.stakeId,
          p_ward_id: input.wardId,
          p_name: trimBlank(input.name),
          p_phone: input.noPhone ? null : normalizePhone(input.phone),
          p_email: trimBlank(input.email) || null,
          p_line_id: trimBlank(input.lineId) || null,
          p_course_ids: input.courseIds,
          p_lunch_option_id: input.lunchOptionId,
          p_afternoon_activity_id: input.afternoonActivityId,
          p_choir_part: input.choirPart,
          p_services: input.services,
          p_printed_handbook: input.printedHandbook,
          p_portrait_consent: input.portraitConsent,
        })
        .single<RegistrationRow>(),
    input,
  );
}

/** 修改報名的輸入：哪一筆、查詢時用的姓名與電話（或報名編號），以及修改後的內容。 */
export type UpdateInput = { registrationId: string; lookup: LookupInput; changes: RegistrationChanges };

/**
 * 修改報名：在報名中、姓名與電話（或報名編號）仍符合這一筆時，整筆換成修改後的內容。
 * 和送出同一套名額檢查；她原本已佔的課程、午餐、午后動態不再檢查名額，新選的才檢查。
 * 任何一項不通過，整筆都不寫入，原本的報名完整保留。
 */
export async function updateRegistration(
  supabase: SupabaseClient,
  { registrationId, lookup, changes }: UpdateInput,
): Promise<SubmitResult> {
  const errors = validateChanges(changes);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const identity = identityParams(registrationId, lookup);
  if (!identity) return { ok: false, errors: { form: "notFound" } };

  return saved(
    "update_registration",
    () =>
      supabase.rpc("update_registration", {
        ...identity,
        // 改電話的修改已經存下、回應卻斷掉時，她再送一次：資料庫也拿這支新的電話比對（見 update_registration）。
        p_phone: changes.noPhone ? null : normalizePhone(changes.phone),
        p_email: trimBlank(changes.email) || null,
        p_line_id: trimBlank(changes.lineId) || null,
        p_venue_id: changes.venueId,
        p_course_ids: changes.courseIds,
        p_lunch_option_id: changes.lunchOptionId,
        p_afternoon_activity_id: changes.afternoonActivityId,
        p_choir_part: changes.choirPart,
        p_services: changes.services,
        p_printed_handbook: changes.printedHandbook,
      }),
    changes,
  );
}

/**
 * 修改、取消時比對身分的參數：哪一筆，以及查詢時用的姓名與電話（或報名編號，6 碼的是報名編號）。
 * 報名 id、姓名或電話沒填時是 null，不必去資料庫比對。
 */
function identityParams(registrationId: string, lookup: LookupInput) {
  const identifier = normalizePhone(lookup.phoneOrNumber);
  const isNumber = isRegistrationNumber(identifier);
  if (!UUID_PATTERN.test(registrationId) || !trimBlank(lookup.name) || !identifier) return null;
  return {
    p_registration_id: registrationId,
    p_lookup_name: trimBlank(lookup.name),
    p_lookup_phone: isNumber ? null : identifier,
    p_lookup_registration_number: isNumber ? identifier : null,
  };
}

/** 取消報名的輸入：哪一筆，以及查詢時用的姓名與電話（或報名編號）。 */
export type CancelInput = { registrationId: string; lookup: LookupInput };

export type CancelError =
  | "notOpen"
  /** 找不到這筆報名：姓名、電話不符。 */
  | "notFound"
  /** 同一個姓名猜錯太多次，和查詢、修改一起暫停一陣子。 */
  | "tooManyAttempts"
  | "unknown";

export type CancelResult = { ok: true } | { ok: false; error: CancelError };

/**
 * 取消報名：在報名中、姓名與電話（或報名編號）仍符合這一筆時，標記為已取消並記下取消時間，不刪除。
 * 名額立即釋出。已經取消的再取消一次照樣成功（回應斷掉後重按）。
 */
export async function cancelRegistration(
  supabase: SupabaseClient,
  { registrationId, lookup }: CancelInput,
): Promise<CancelResult> {
  const identity = identityParams(registrationId, lookup);
  if (!identity) return { ok: false, error: "notFound" };

  const { data, error } = await supabase.rpc("cancel_registration", identity);
  if (error) {
    if (error.message === "registration_not_open") return { ok: false, error: "notOpen" };
    if (error.message === "too_many_attempts") return { ok: false, error: "tooManyAttempts" };
    console.error("cancel_registration failed", error);
    return { ok: false, error: "unknown" };
  }
  // 找不到她的報名時，函式回傳 null（不丟出代碼，猜錯的紀錄才會留下）。
  if (!(data as { id?: string } | null)?.id) return { ok: false, error: "notFound" };
  return { ok: true };
}

/** 呼叫寫入報名的資料庫函式，把結果或丟出的代碼轉成 SubmitResult。 */
async function saved(
  name: string,
  call: () => PromiseLike<PostgrestSingleResponse<RegistrationRow | null>>,
  input: RegistrationChanges,
): Promise<SubmitResult> {
  let response = await call();
  // 管理員同時調整幾門課的名額時，可能和報名互相等待，資料庫會中止其中一邊（deadlock detected）。
  // 被中止的報名整筆都沒寫入，直接重送就好，不必讓她看到「系統出了問題」。
  for (let retry = 0; response.error?.code === DEADLOCK_DETECTED && retry < 2; retry++) {
    response = await call();
  }
  const { data, error } = response;
  if (error) {
    // 有課程額滿時是 course_full，只有午餐、午后動態額滿時是 choice_full，兩者都列出所有額滿的選項。
    if (error.message === "course_full" || error.message === "choice_full") {
      const fullIds = error.details ? error.details.split(",") : [];
      return { ok: false, errors: fullErrors(input, fullIds), fullIds };
    }
    const known = databaseErrors[error.message] ?? constraintErrors[violatedConstraint(error.message)];
    if (known) return { ok: false, errors: known };
    console.error(`${name} failed`, error);
    return { ok: false, errors: { form: "unknown" } };
  }
  // 修改時找不到她的報名，函式回傳 null（不丟出代碼，猜錯的紀錄才會留下）。
  if (!data?.id) return { ok: false, errors: { form: "notFound" } };

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
      // 資料庫在同一個交易裡存下了所選的每一門課，成功就是送出的這些。
      courseIds: input.courseIds,
      lunchOptionId: data.lunch_option_id,
      afternoonActivityId: data.afternoon_activity_id,
      choirPart: data.choir_part,
      services: data.services,
      printedHandbook: data.printed_handbook,
    },
  };
}

/** 額滿的選項標在各自的欄位旁；不知道是哪一項時（不該發生），她選了的每一項都請她確認。 */
function fullErrors(input: RegistrationChanges, fullIds: string[]): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const isFull = (id: string | null) =>
    id !== null && (fullIds.length === 0 || fullIds.includes(id));
  if (input.courseIds.some(isFull)) errors.courses = "courseFull";
  if (isFull(input.lunchOptionId)) errors.lunch = "lunchFull";
  if (isFull(input.afternoonActivityId)) errors.afternoonActivity = "afternoonActivityFull";
  return errors;
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
  lunch_option_id: string | null;
  afternoon_activity_id: string | null;
  choir_part: ChoirPart | null;
  services: Service[];
  printed_handbook: boolean;
};

/** 查詢報名的輸入：姓名，以及電話或報名編號（同一個欄位，6 碼是報名編號，其他當成電話）。 */
export type LookupInput = { name: string; phoneOrNumber: string };

export type LookupField = "name" | "phoneOrNumber" | "form";

export type LookupError =
  | "nameRequired"
  | "phoneOrNumberRequired"
  | "phoneOrNumberInvalid"
  /** 找不到符合的報名。不說是哪一項不對，免得被拿來猜別人的資料。 */
  | "notFound"
  /** 同一個姓名短時間內猜錯太多次，暫停查詢一陣子。 */
  | "tooManyAttempts"
  | "unknown";

export type LookupErrors = Partial<Record<LookupField, LookupError>>;

/** 查到的報名：存下的資料，加上狀態與報名當下的支聯會、支會名稱（已依語言挑好）。 */
export type FoundRegistration = Registration & {
  status: "registered" | "cancelled";
  stakeName: string;
  wardName: string;
};

export type LookupResult =
  | { ok: true; registrations: FoundRegistration[] }
  | { ok: false; errors: LookupErrors };

/**
 * 查詢報名：姓名與電話（或報名編號）兩項都符合才找得到，只找目前年度。
 * 報名截止後仍可查詢。同一組姓名與電話有好幾筆時（例如取消後重新報名）全部回傳，新的在前。
 */
export async function lookupRegistration(
  supabase: SupabaseClient,
  input: LookupInput,
  locale: Locale,
): Promise<LookupResult> {
  const errors: LookupErrors = {};
  const name = trimBlank(input.name);
  if (!name) errors.name = "nameRequired";
  const identifier = normalizePhone(input.phoneOrNumber);
  const isNumber = isRegistrationNumber(identifier);
  if (!identifier) errors.phoneOrNumber = "phoneOrNumberRequired";
  else if (!isNumber && !PHONE_PATTERN.test(identifier)) errors.phoneOrNumber = "phoneOrNumberInvalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const { data, error } = await supabase.rpc("lookup_registration", {
    p_name: name,
    p_phone: isNumber ? null : identifier,
    p_registration_number: isNumber ? identifier : null,
  });
  if (error) {
    if (error.message === "too_many_attempts") return { ok: false, errors: { form: "tooManyAttempts" } };
    console.error("lookup_registration failed", error);
    return { ok: false, errors: { form: "unknown" } };
  }
  const rows = data as LookupRow[];
  if (rows.length === 0) return { ok: false, errors: { form: "notFound" } };

  return {
    ok: true,
    registrations: rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      registrationNumber: row.registration_number,
      email: row.email,
      lineId: row.line_id,
      stakeId: row.stake_id,
      wardId: row.ward_id,
      venueId: row.venue_id,
      courseIds: row.course_ids,
      lunchOptionId: row.lunch_option_id,
      afternoonActivityId: row.afternoon_activity_id,
      choirPart: row.choir_part,
      services: row.services,
      printedHandbook: row.printed_handbook,
      status: row.status,
      stakeName: localized(row, "stake_name", locale),
      wardName: localized(row, "ward_name", locale),
    })),
  };
}

type LookupRow = RegistrationRow & {
  course_ids: string[];
  status: "registered" | "cancelled";
  stake_name_zh: string;
  stake_name_en: string;
  ward_name_zh: string;
  ward_name_en: string;
};
