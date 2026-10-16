import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { ItemKind, ProgrammeError } from "@/lib/programme";
import { REGION_LABELS, REGIONS, type Region } from "@/lib/staff";
import { cn } from "@/lib/utils";
import { buttonClass, inputClass } from "../../ui";
import { deleteProgrammeItem, saveProgrammeItem } from "./actions";

/* 課程安排兩個頁面共用的表單與訊息。 */

export const DONE: Record<string, string> = {
  saved: "已儲存。",
  deleted: "已刪除。",
  paired: "已設成成對課程。",
  unpaired: "已拆開成對課程。",
};

export const ERRORS: Record<ProgrammeError, string> = {
  not_admin: "只有總管理員能編輯課程安排。",
  name_required: "請填中文名稱。",
  region_required: "請選場地在哪一區。",
  capacity_invalid: "名額要填正整數；不限人數請留空白。",
  position_invalid: "排序要填整數。",
  classroom_invalid: "教室最多 50 個字。",
  in_use:
    "已經有人報名選了這一項（包括已取消的報名），不能刪除，報名紀錄才不會少了它。請先處理這些報名。",
  programme_locked: "報名已經開放，不能再新增、刪除或換時段；只能修正文字、調整名額、排序與教室。",
  course_pair_invalid:
    "成對課程要是同一場地、連續兩個場次的兩堂課，而且每門課只能屬於一組；已設成對時，兩堂中間不能再加場次。",
  not_found: "找不到這一項，可能已經被刪除。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

/** 新增或修改一個項目的表單。共通的隱藏欄位在這裡，各種項目的欄位放在 children。 */
export function ItemForm({
  kind,
  id,
  conferenceId,
  venueId,
  parentId,
  submitLabel,
  children,
}: {
  kind: ItemKind;
  id?: string;
  conferenceId: string;
  /** 做完回到哪個場地的編輯頁；新增場地時不填。 */
  venueId?: string;
  parentId?: string;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <form action={saveProgrammeItem} className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="conferenceId" value={conferenceId} />
      {venueId && <input type="hidden" name="venueId" value={venueId} />}
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      {children}
      <button className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>{submitLabel}</button>
    </form>
  );
}

/** 中英兩欄。英文沒填時前台顯示中文。 */
export function TextPair({
  name,
  label,
  zh = "",
  en = "",
  required = false,
  multiline = false,
}: {
  name: string;
  label: string;
  zh?: string;
  en?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const Input = multiline ? "textarea" : "input";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">
          {label}（中文）{required && <span className="text-destructive">＊</span>}
        </span>
        <Input name={`${name}Zh`} defaultValue={zh} required={required} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{label}（英文）</span>
        <Input name={`${name}En`} defaultValue={en} className={inputClass} />
      </label>
    </div>
  );
}

/** 場地所在的區。課務組、報報組依這個看得到報名這個場地的人。 */
export function RegionField({ region }: { region?: Region }) {
  return (
    <label className="flex flex-col gap-1 sm:max-w-xs">
      <span className="font-semibold">
        區<span className="text-destructive">＊</span>
      </span>
      <select name="region" defaultValue={region ?? ""} required className={inputClass}>
        <option value="" disabled>
          請選擇
        </option>
        {REGIONS.map((candidate) => (
          <option key={candidate} value={candidate}>
            {REGION_LABELS[candidate]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 名額與排序。名額空白表示不限；沒有名額的項目（場地、場次）只有排序。 */
export function NumberFields({ capacity, position = 0 }: { capacity?: number | null; position?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {capacity !== undefined && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">名額</span>
          <input
            name="capacity"
            type="number"
            min={1}
            step={1}
            defaultValue={capacity ?? ""}
            placeholder="不限"
            className={inputClass}
          />
          <span className="text-sm text-muted-foreground">不限人數請留空白。</span>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">排序</span>
        <input name="position" type="number" step={1} defaultValue={position} className={inputClass} />
        <span className="text-sm text-muted-foreground">數字小的排在前面。</span>
      </label>
    </div>
  );
}

/** 刪除按鈕。不用跳出視窗，展開後再按一次才刪除。 */
export function DeleteItem({
  kind,
  id,
  venueId,
  label,
  warning,
}: {
  kind: ItemKind;
  id: string;
  venueId: string;
  label: string;
  warning?: string;
}) {
  return (
    <details>
      <summary className="cursor-pointer font-semibold text-destructive">刪除{label}</summary>
      <form action={deleteProgrammeItem} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="venueId" value={venueId} />
        <p>{warning ?? `確定要刪除這個${label}嗎？刪除後不能復原。`}</p>
        <button
          className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}
        >
          確定刪除
        </button>
      </form>
    </details>
  );
}

/** 名額的顯示文字。 */
export function capacityLabel(capacity: number | null) {
  return capacity === null ? "不限" : `${capacity} 人`;
}
