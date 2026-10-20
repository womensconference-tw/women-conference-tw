import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { REGISTRANT_ROLE_LABELS, UUID_PATTERN, type ChoirPart, type RegistrantRole, type Service } from "./registration";
import { writeXlsx, type Sheet } from "./xlsx";

/*
 * 大會結束後下載年度 Excel、確認存好再清除個資（#26、ADR 0008）。只有總管理員能做，只能在大會結束（大會日期翌日台北時間 00:00）之後，
 * 都由資料庫函式檢查（start_year_export、complete_year_export、clear_personal_data、year_export_overview）。
 * 下載時資料庫記一筆匯出紀錄，Excel 完整產生之後才標成完成；清除綁定畫面上勾選的那一筆，
 * 下載之後有報名新增、修改、取消（資料版本號變了）就拒絕，請總管理員重新下載。
 */

export type YearExportError =
  | "not_admin"
  | "not_found"
  | "conference_not_ended"
  | "personal_data_cleared"
  | "unavailable";

export type ClearPersonalDataError =
  | YearExportError
  /** 沒勾「Excel 已存好、打得開」。 */
  | "not_confirmed"
  /** 這個年度沒有這一筆已完成的匯出紀錄（沒下載、產檔失敗、或是別的年度的）。 */
  | "export_not_found"
  /** 下載之後資料有變動，要重新下載。 */
  | "export_outdated"
  /** 別的總管理員下載的那一份：各自確認自己那一份。 */
  | "export_not_mine";

/** start_year_export 回傳的年度內容：產生 Excel 需要的全部資料，和匯出紀錄的版本是同一個資料快照。 */
export type YearExportData = {
  export_id: string;
  data_version: number;
  registration_count: number;
  /** 依顯示順序的場地，各自依順序列出有開課的場次。 */
  venues: { id: string; name: string; sessions: { id: string; name: string }[] }[];
  /** 有效報名，依場地順序、報名先後排序。 */
  registrations: {
    name: string;
    venue_id: string;
    locale: string;
    /** 午餐名稱；null 是「不需要」。 */
    lunch: string | null;
    role: RegistrantRole;
    choir_part: ChoirPart | null;
    services: Service[];
    printed_handbook: boolean;
    /** 場次編號 → 所選課程名稱；沒有的場次是「不選課」。 */
    courses: Record<string, string>;
  }[];
};

const CHOIR_LABELS: Record<ChoirPart, string> = { soprano: "女高音", alto: "女低音" };

// 欄位名稱與順序沿用舊系統的試算表（ADR 0008）。
const SERVICE_COLUMNS: [Service, string][] = [
  ["setup", "事前準備志工"],
  ["translation", "翻譯人員"],
  ["reception", "當天接待志工"],
  ["cleanup", "事後復原志工"],
];

/**
 * 年度 Excel 的兩個工作表：
 * - 「名單」一列一筆有效報名。N 是場次最多的場地的場次數，各場地依自己的場次順序填入第 1 至 N 場次課程，
 *   有這個場次但沒選課填「不選課」，場地沒有這個場次填「不適用」（午后動態就是其中一個場次）。
 * - 「場次對照」列出每個場地第 1 至 N 場次的實際名稱（名稱裡寫著時間）。
 * 沒有有效報名時「名單」只有表頭。不含電話、Email、LINE ID、報名編號、支聯會、支會。
 */
export function yearWorkbook(data: Pick<YearExportData, "venues" | "registrations">): Sheet[] {
  const sessionCount = Math.max(0, ...data.venues.map((venue) => venue.sessions.length));
  const positions = Array.from({ length: sessionCount }, (_, index) => index);
  const venues = new Map(data.venues.map((venue) => [venue.id, venue]));

  const roster = [
    [
      "姓名",
      "參加教堂",
      "報名語言",
      "午餐",
      ...positions.map((index) => `第${chineseNumber(index + 1)}場次課程`),
      "類別",
      "即席唱詩班",
      ...SERVICE_COLUMNS.map(([, label]) => label),
      "是否要紙本手冊",
    ],
    ...data.registrations.map((registration) => {
      const venue = venues.get(registration.venue_id);
      return [
        registration.name,
        venue?.name ?? "",
        registration.locale,
        registration.lunch ?? "不需要",
        ...positions.map((index) => {
          const session = venue?.sessions[index];
          if (!session) return "不適用";
          return registration.courses[session.id] ?? "不選課";
        }),
        REGISTRANT_ROLE_LABELS[registration.role] ?? registration.role,
        registration.choir_part ? CHOIR_LABELS[registration.choir_part] : "不參加",
        ...SERVICE_COLUMNS.map(([service]) => (registration.services.includes(service) ? "是" : "否")),
        registration.printed_handbook ? "需要" : "不需要",
      ];
    }),
  ];

  const sessions = [
    ["場地", ...positions.map((index) => `第${chineseNumber(index + 1)}場次`)],
    ...data.venues.map((venue) => [venue.name, ...positions.map((index) => venue.sessions[index]?.name ?? "不適用")]),
  ];

  return [
    { name: "名單", rows: roster },
    { name: "場次對照", rows: sessions },
  ];
}

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1 → 一、10 → 十、12 → 十二、20 → 二十（場次不會到一百）。 */
export function chineseNumber(value: number): string {
  if (value < 10) return DIGITS[value];
  const tens = Math.floor(value / 10);
  return `${tens === 1 ? "" : DIGITS[tens]}十${DIGITS[value % 10]}`;
}

/**
 * 下載年度 Excel：讀年度內容、產生 Excel，完整產生之後才把匯出紀錄標成完成。
 * write 是產生 Excel 的方式（測試換成會失敗或中途做別的事的）；它丟出例外時匯出紀錄不會完成。
 */
export async function exportYearExcel(
  supabase: SupabaseClient,
  conferenceId: string,
  write: (sheets: Sheet[]) => Uint8Array | Promise<Uint8Array> = writeXlsx,
): Promise<{ ok: true; exportId: string; bytes: Uint8Array } | { ok: false; error: YearExportError }> {
  if (!UUID_PATTERN.test(conferenceId)) return { ok: false, error: "not_found" };
  const started = await supabase.rpc("start_year_export", { p_conference_id: conferenceId });
  if (started.error) return { ok: false, error: exportFailure(started.error) };
  const data = started.data as YearExportData;

  const bytes = await write(yearWorkbook(data));

  const completed = await supabase.rpc("complete_year_export", { p_export_id: data.export_id });
  if (completed.error) return { ok: false, error: exportFailure(completed.error) };
  return { ok: true, exportId: data.export_id, bytes };
}

/** 一筆已完成的匯出紀錄。 */
export type YearExportRecord = {
  id: string;
  /** Excel 產生完成、開始傳送的時間。 */
  completedAt: string;
  exportedByName: string;
  /** Excel 裡的有效報名筆數。 */
  registrationCount: number;
  /** 下載之後資料有變動：不能拿來清除，要重新下載。 */
  outdated: boolean;
  /** 是自己下載的：只能用自己下載的那一份清除。 */
  mine: boolean;
};

export type YearExportOverview = {
  ended: boolean;
  /** 清除個資的時間；還沒清除是 null。 */
  clearedAt: string | null;
  /** 該年度全部報名的筆數（含已取消），就是將清除個資的筆數。 */
  registrationTotal: number;
  /** 已完成的匯出紀錄，新的在前。 */
  exports: YearExportRecord[];
};

/** 清除畫面的內容。不是總管理員或年度不存在時是 null。 */
export async function getYearExportOverview(
  supabase: SupabaseClient,
  conferenceId: string,
): Promise<YearExportOverview | null> {
  if (!UUID_PATTERN.test(conferenceId)) return null;
  const { data, error } = await supabase.rpc("year_export_overview", { p_conference_id: conferenceId });
  if (error) {
    if (error.message === "not_admin" || error.message === "not_found" || error.code === "42501") return null;
    throw error;
  }
  const row = data as {
    ended: boolean;
    cleared_at: string | null;
    registration_total: number;
    exports: {
      id: string;
      completed_at: string;
      exported_by_name: string;
      registration_count: number;
      outdated: boolean;
      mine: boolean;
    }[];
  };
  return {
    ended: row.ended,
    clearedAt: row.cleared_at,
    registrationTotal: row.registration_total,
    exports: row.exports.map((record) => ({
      id: record.id,
      completedAt: record.completed_at,
      exportedByName: record.exported_by_name,
      registrationCount: record.registration_count,
      outdated: record.outdated,
      mine: record.mine,
    })),
  };
}

export type ClearPersonalDataInput = {
  conferenceId: string;
  /** 畫面上那一筆匯出紀錄（不是「最近一次」）。 */
  exportId: string;
  /** 有沒有勾「Excel 已存好、打得開」。 */
  confirmed: boolean;
};

/**
 * 確認 Excel 已存好之後清除一個年度的個資（不可還原）。已經清除過的回傳成功與原本的清除時間（alreadyCleared）。
 */
export async function clearPersonalData(
  supabase: SupabaseClient,
  { conferenceId, exportId, confirmed }: ClearPersonalDataInput,
): Promise<
  { ok: true; clearedAt: string; alreadyCleared: boolean } | { ok: false; error: ClearPersonalDataError }
> {
  if (!UUID_PATTERN.test(conferenceId)) return { ok: false, error: "not_found" };
  if (!UUID_PATTERN.test(exportId)) return { ok: false, error: "export_not_found" };
  const { data, error } = await supabase.rpc("clear_personal_data", {
    p_conference_id: conferenceId,
    p_export_id: exportId,
    p_confirmed: confirmed,
  });
  if (error) {
    const known = ["not_confirmed", "export_not_found", "export_outdated", "export_not_mine"] as const;
    const code = known.find((value) => value === error.message);
    return { ok: false, error: code ?? exportFailure(error) };
  }
  const result = data as { cleared_at: string; already_cleared: boolean };
  return { ok: true, clearedAt: result.cleared_at, alreadyCleared: result.already_cleared };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function exportFailure(error: PostgrestError): YearExportError {
  switch (error.message) {
    case "not_admin":
    case "not_found":
    case "conference_not_ended":
    case "personal_data_cleared":
      return error.message;
  }
  if (error.code === "42501") return "not_admin";
  console.error("年度 Excel 與清除個資失敗", { code: error.code, message: error.message });
  return "unavailable";
}

/** 大會結束了沒：大會日期翌日的台北時間 00:00 之後（台灣沒有日光節約時間）。和資料庫的 conference_ended 一致。 */
export function conferenceEnded(conferenceDate: string, at: Date = new Date()): boolean {
  return at.getTime() >= Date.parse(`${conferenceDate}T00:00:00+08:00`) + 24 * 60 * 60 * 1000;
}

/** 下載的檔名，例如「2026 年姐妹大會名單.xlsx」。 */
export function yearExcelFileName(year: number): string {
  return `${year} 年姐妹大會名單.xlsx`;
}
