import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";
import { CHOIR_PARTS, SERVICES } from "@/lib/registration";
import { REGION_LABELS } from "@/lib/staff";
import { formatUsage, getStatistics, venuesInView } from "@/lib/statistics";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listConferences } from "@/lib/years";
import { getCurrentStaff } from "../../current-staff";
import { buttonClass, inputClass } from "../../ui";
import { SubmitButton } from "../../submit-button";

export const metadata: Metadata = { title: "統計" };

const labels = messages.zh.register;

/**
 * 統計：自己範圍內的有效報名人數，依場地、支聯會、支會、課程、午餐等分列。範圍由資料庫決定。
 * 預設是目前年度，可以選年度看舊年度（範圍一樣）。
 */
export default async function StatisticsPage({ searchParams }: PageProps<"/staff/statistics">) {
  const supabase = await createClient();
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");

  const { year: yearParam } = await searchParams;
  const years = await listConferences(supabase);
  // 沒選、或選的年度不在清單裡（網址被改過）時，是目前年度。
  const selected = years.find((year) => String(year.year) === yearParam) ?? years.find((year) => year.isCurrent);
  const statistics = selected ? await getStatistics(supabase, selected.id) : null;
  const scope = me.region ? REGION_LABELS[me.region] : me.role === "admin" ? null : "全區";
  const venues = statistics ? venuesInView(statistics.venues, me) : [];

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">統計{selected && `（${selected.year} 年）`}</h1>
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

      {!statistics ? (
        <p>{years.length === 0 ? "還沒有年度大會。" : "還沒有設定目前年度，請選年度查看。"}</p>
      ) : (
        <>
          <p role="status">
            {scope ? `你負責${scope}，` : ""}只計有效報名，已取消的不計。共 <strong>{statistics.total}</strong> 人。
          </p>

          <Section title="各場地">
            <CountTable
              heading="場地"
              rows={venues.map((venue) => ({
                key: venue.id,
                label: venue.partial ? `${venue.name}（只計${scope}支聯會）` : venue.name,
                value: venue.count,
              }))}
            />
          </Section>

          <Section title="各支聯會、支會">
            {statistics.stakes.length === 0 ? (
              <p>還沒有人報名。</p>
            ) : (
              <CountTable
                heading="支聯會／支會"
                rows={statistics.stakes.flatMap((stake) => [
                  { key: stake.id, label: stake.name, value: stake.count, strong: true },
                  ...stake.wards.map((ward) => ({ key: ward.id, label: ward.name, value: ward.count, indent: true })),
                ])}
              />
            )}
          </Section>

          {venues.map((venue) => (
            <Section key={venue.id} title={`${venue.name}：課程與午餐`}>
              {venue.partial && (
                <p className="text-muted-foreground">別區教堂，只計{scope}支聯會的姐妹，不是全部，所以不列容量。</p>
              )}
              {venue.sessions.map((session) => (
                <CountTable
                  key={session.id}
                  heading={session.name}
                  valueHeading="已報／容量"
                  rows={[
                    ...session.courses.map((course) => ({
                      key: course.id,
                      label: withStopped(course.title, course.stopped),
                      value: formatUsage(course, venue.partial),
                    })),
                    { key: "none", label: "不選課", value: session.noCourse },
                  ]}
                />
              ))}
              {venue.lunches.length > 0 && (
                <CountTable
                  heading="午餐"
                  valueHeading="數量"
                  rows={[
                    ...venue.lunches.map((lunch) => ({
                      key: lunch.id,
                      label: withStopped(lunch.name, lunch.stopped),
                      value: formatUsage(lunch, venue.partial),
                    })),
                    { key: "none", label: "不需要", value: venue.noLunch },
                  ]}
                />
              )}
            </Section>
          ))}

          <Section title="服務意願與紙本手冊">
            <CountTable
              heading="項目"
              rows={[
                ...CHOIR_PARTS.map((part) => ({
                  key: part,
                  label: labels.choirWithPart(labels.choirParts[part]),
                  value: statistics.choir[part],
                })),
                ...SERVICES.map((service) => ({
                  key: service,
                  label: labels.serviceNames[service],
                  value: statistics.services[service],
                })),
                { key: "handbook", label: "要紙本手冊", value: statistics.printedHandbook },
              ]}
            />
          </Section>
        </>
      )}
    </main>
  );
}

/** 總管理員停止報名的選項在名稱後面標出來（GLOSSARY「停止報名」）。 */
function withStopped(name: string, stopped: boolean): string {
  return stopped ? `${name}（已停止報名）` : name;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

type Row = { key: string; label: string; value: number | string; strong?: boolean; indent?: boolean };

function CountTable({ heading, valueHeading = "人數", rows }: { heading: string; valueHeading?: string; rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-xl border-collapse text-left">
        <thead>
          <tr className="border-b-2">
            <th className="p-2">{heading}</th>
            <th className="p-2 text-right whitespace-nowrap">{valueHeading}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b">
              <td className={cn("p-2", row.strong && "font-semibold", row.indent && "pl-6")}>{row.label}</td>
              <td className={cn("p-2 text-right whitespace-nowrap tabular-nums", row.strong && "font-semibold")}>
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
