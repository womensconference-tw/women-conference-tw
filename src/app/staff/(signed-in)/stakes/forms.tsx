import { buttonVariants } from "@/components/ui/button";
import { REGION_LABELS, REGIONS } from "@/lib/staff";
import type { Site, StakeError, UnitKind } from "@/lib/stakes";
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
  site_invalid: "找不到這個場地，請重新選擇。",
  in_use: "已經有人報名時選了它（包括已取消的報名），不能刪除，報名紀錄才不會少了它。可以改成停用。",
  not_found: "找不到這一項，可能已經被刪除。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};

/** 新增支聯會時選區。報報組依這個看得到該區支聯會的姐妹報名別區教堂的報名。之後不能改。 */
export function RegionField() {
  return (
    <label className="flex flex-col gap-1 sm:max-w-xs">
      <span className="font-semibold">
        區<span className="text-destructive">＊</span>
      </span>
      <select name="region" defaultValue="" required className={inputClass}>
        <option value="" disabled>
          請選擇
        </option>
        {REGIONS.map((candidate) => (
          <option key={candidate} value={candidate}>
            {REGION_LABELS[candidate]}
          </option>
        ))}
      </select>
      <span className="text-sm text-muted-foreground">新增後不能改；要改區請停用這個支聯會，再新增一個。</span>
    </label>
  );
}

/** 預設場地：從各年度的教堂中挑選，複製新年度後仍然有效。 */
export function SiteField({ sites, value }: { sites: Site[]; value: string | null }) {
  const latestYear = sites[0]?.year;
  return (
    <label className="flex flex-col gap-1 sm:max-w-md">
      <span className="font-semibold">預設場地</span>
      <select name="defaultSiteKey" defaultValue={value ?? ""} className={inputClass}>
        <option value="">未設定</option>
        {sites.map((site) => (
          <option key={site.siteKey} value={site.siteKey}>
            {site.nameZh}
            {site.year !== latestYear && `（${site.year} 年）`}
          </option>
        ))}
      </select>
      <span className="text-sm text-muted-foreground">
        只用來標記跨區，不限制報名者選哪個場地。{sites.length === 0 && "還沒有場地，請先到「場地與課程」新增。"}
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
