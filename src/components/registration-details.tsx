import type { Messages } from "@/lib/i18n/messages";
import type { RegistrationOptions } from "@/lib/registration-options";
import { summarizeRegistration, type Details } from "@/lib/registration-summary";
import { cn } from "@/lib/utils";

/**
 * 報名資料的清單，確認步驟、完成頁與查詢頁共用；列出哪些內容見 summarizeRegistration。
 * 排得緊湊（標籤與內容同一行、支聯會併進支會），讓完成頁在手機上一個畫面就截得下。
 * 完成頁與查詢頁有報名編號時，編號取代「沒有電話」那一列。
 */
export function RegistrationDetails({
  registration,
  registrationNumber,
  options,
  t,
}: {
  registration: Details;
  registrationNumber?: string | null;
  options: RegistrationOptions;
  t: Messages;
}) {
  const { rows, courses, extraRows } = summarizeRegistration(registration, options, t, {
    done: registrationNumber !== undefined,
    registrationNumber,
  });
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 leading-snug">
      {/* 報名編號自己一列、放大，標籤較長（英文）時編號換到下一行，不擠窄其他列。 */}
      {registrationNumber && (
        <div className="col-span-2 flex flex-wrap items-baseline gap-x-4">
          <dt className="font-semibold">{t.register.done.registrationNumberLabel}</dt>
          <dd className="text-heading font-bold tracking-widest">{registrationNumber}</dd>
        </div>
      )}
      {rows.map(({ label, value }) => (
        <DetailRow key={label} label={label} value={value} />
      ))}
      {/* 場次名稱通常含時間、比較長，所以課程一個場次佔兩行：場次、所選課程。 */}
      {courses.map(({ session, course }, index) => (
        <div key={index} className={cn("col-span-2", index === 0 && "mt-2")}>
          <dt className="font-semibold">{session}</dt>
          <dd className="wrap-anywhere">{course}</dd>
        </div>
      ))}
      {extraRows.map(({ label, value }, index) => (
        <DetailRow key={label} label={label} value={value} className={cn(index === 0 && "mt-2")} />
      ))}
    </dl>
  );
}

function DetailRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("col-span-2 grid grid-cols-subgrid items-baseline", className)}>
      <dt className="font-semibold">{label}</dt>
      {/* Email 這類沒有空白的長字串也要能斷行，不能撐出框外。 */}
      <dd className="min-w-0 wrap-anywhere">{value}</dd>
    </div>
  );
}
