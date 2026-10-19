import { buttonVariants } from "@/components/ui/button";
import { REGION_LABELS, REGIONS } from "@/lib/staff";
import type { Region } from "@/lib/staff";
import type { StakeError, UnitKind } from "@/lib/stakes";
import { cn } from "@/lib/utils";
import { buttonClass, inputClass } from "../../ui";
import { deleteUnitItem, setUnitActiveItem } from "./actions";
import { SubmitButton } from "../../submit-button";

/* 支聯會名單兩個頁面共用的表單與訊息。 */

export const DONE: Record<string, string> = {
  saved: "已儲存。",
  activated: "已重新啟用，報名表會再列出。",
  deactivated: "已停用，報名表不再列出；舊報名照常顯示。",
  deleted: "已刪除。",
};

export const ERRORS: Record<StakeError, string> = {
  not_admin: "只有總管理員能編輯支聯會名單。",
  name_required: "請填中文名稱。",
  region_required: "請選支聯會在哪一區。",
  position_invalid: "排序要填整數。",
  in_use: "已經有人報名時選了它（包括已取消的報名），或籌備委員會名單上有人屬於它，不能刪除，紀錄才不會少了它。可以改成停用。",
  not_found: "找不到這一項，可能已經被刪除。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

/**
 * 支聯會在哪一區。報報組依這個看得到該區支聯會的姐妹報名別區教堂的報名；
 * 姐妹選的教堂不在這一區時，名單上標跨區。
 */
export function RegionField({ value }: { value?: Region }) {
  return (
    <label className="flex flex-col gap-1 sm:max-w-xs">
      <span className="font-semibold">
        區<span className="text-destructive">＊</span>
      </span>
      <select name="region" defaultValue={value ?? ""} required className={inputClass}>
        <option value="" disabled>
          請選擇
        </option>
        {REGIONS.map((candidate) => (
          <option key={candidate} value={candidate}>
            {REGION_LABELS[candidate]}
          </option>
        ))}
      </select>
      <span className="text-sm text-muted-foreground">
        改區後，這個支聯會的報名都算新的區：報報組的範圍、跨區標記都跟著換。
      </span>
    </label>
  );
}

/** 停用或重新啟用。 */
export function ActiveToggle({
  kind,
  id,
  stakeId,
  isActive,
}: {
  kind: UnitKind;
  id: string;
  stakeId: string;
  isActive: boolean;
}) {
  return (
    <form action={setUnitActiveItem}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="stakeId" value={stakeId} />
      <input type="hidden" name="active" value={String(!isActive)} />
      <SubmitButton className={cn(buttonVariants({ variant: "outline" }), buttonClass)}>
        {isActive ? "停用" : "重新啟用"}
      </SubmitButton>
    </form>
  );
}

/** 刪除按鈕。不用跳出視窗，展開後再按一次才刪除。 */
export function DeleteUnit({ kind, id, stakeId, label }: { kind: UnitKind; id: string; stakeId: string; label: string }) {
  return (
    <details>
      <summary className="cursor-pointer font-semibold text-destructive">刪除{label}</summary>
      <form action={deleteUnitItem} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="stakeId" value={stakeId} />
        <p>
          {kind === "stake" ? "它的支會會一起刪除。" : ""}
          只有輸入錯誤、還沒有人報名的才能刪除；已經有人報名的請改成停用。刪除後不能復原。
        </p>
        <SubmitButton
          className={cn(buttonVariants(), buttonClass, "self-start bg-destructive text-white hover:bg-destructive/80")}
        >
          確定刪除
        </SubmitButton>
      </form>
    </details>
  );
}

/** 新增時預填的排序：排在目前最後一個之後。 */
export function nextPosition(items: { position: number }[]) {
  return Math.max(0, ...items.map((item) => item.position)) + 1;
}

/** 停用中的標示。 */
export function InactiveBadge() {
  return (
    <span className="rounded-md border-2 border-destructive px-2 py-0.5 text-sm font-semibold text-destructive">
      已停用
    </span>
  );
}
