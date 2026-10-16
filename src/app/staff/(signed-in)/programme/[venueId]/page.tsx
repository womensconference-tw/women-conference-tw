import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  getProgramme,
  type ItemKind,
  type ProgrammeCourse,
  type ProgrammeOption,
  type ProgrammeSession,
} from "@/lib/programme";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { UUID_PATTERN } from "@/lib/registration";
import { getCurrentStaff } from "../../../current-staff";
import { ResultMessage } from "../../../result-message";
import { buttonClass, inputClass } from "../../../ui";
import { addProgrammeCoursePair, removeProgrammeCoursePair } from "../actions";
import { capacityLabel, DeleteItem, DONE, ERRORS, ItemForm, NumberFields, TextPair } from "../forms";

export const metadata: Metadata = { title: "編輯場地" };

const cardClass = "flex flex-col gap-3 rounded-lg border-2 border-card-outline p-4";

/**
 * 編輯一個場地（只有總管理員）：場地資料、場次與課程（含教室）、成對課程、午餐、午后動態。
 * 報名開放後不顯示新增、刪除與換時段；資料庫也會擋下。
 */
export default async function VenueProgrammePage({ params, searchParams }: PageProps<"/staff/programme/[venueId]">) {
  const me = await getCurrentStaff();
  // 版面和頁面同時執行，版面的導向擋不住這裡，自己也要檢查。
  if (!me) redirect("/staff/login");
  if (me.role !== "admin") notFound();

  const { venueId } = await params;
  if (!UUID_PATTERN.test(venueId)) notFound();
  const programme = await getProgramme(await createClient(), venueId);
  const venue = programme?.venues.find((candidate) => candidate.id === venueId);
  if (!programme || !venue) notFound();

  const { conferenceId, registrationOpened: locked } = programme;
  const shared = { conferenceId, venueId };
  const courses = venue.sessions.flatMap((session) =>
    session.courses.map((course) => ({ ...course, label: `${session.nameZh}｜${course.nameZh}` })),
  );
  const courseLabel = new Map(courses.map((course) => [course.id, course.label]));
  const pairs = programme.coursePairs.filter((pair) => courseLabel.has(pair.firstCourseId));
  const partner = new Map(
    pairs.flatMap((pair) => [
      [pair.firstCourseId, pair.secondCourseId],
      [pair.secondCourseId, pair.firstCourseId],
    ]),
  );

  return (
    <main className="flex flex-col gap-8">
      <Link href="/staff/programme" className="font-semibold underline">
        ← 回到場地列表
      </Link>
      <h1 className="text-2xl font-bold">{venue.nameZh}</h1>
      <ResultMessage searchParams={searchParams} done={DONE} errors={ERRORS} />
      {locked && (
        <p className="rounded-lg border-2 border-card-outline p-3">
          報名已經開放：不能再新增、刪除或換時段，只能修正文字、調整名額、排序與教室。
        </p>
      )}

      <section className={cardClass}>
        <h2 className="text-xl font-bold">場地資料</h2>
        <ItemForm kind="venue" id={venue.id} {...shared} submitLabel="儲存場地資料">
          <TextPair name="name" label="名稱" zh={venue.nameZh} en={venue.nameEn} required />
          <TextPair name="address" label="地址" zh={venue.addressZh} en={venue.addressEn} />
          <TextPair name="features" label="場地特色" zh={venue.featuresZh} en={venue.featuresEn} multiline />
          <NumberFields position={venue.position} />
        </ItemForm>
        {!locked && (
          <DeleteItem
            kind="venue"
            id={venue.id}
            venueId={venueId}
            label="場地"
            warning="刪除場地會連同它的場次、課程、午餐、午后動態一起刪除，不能復原。已經有人報名這個場地時不能刪除。"
          />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">場次與課程</h2>
        {venue.sessions.length === 0 && <p>還沒有場次。</p>}
        {venue.sessions.map((session) => (
          <div key={session.id} className={cardClass}>
            <h3 className="text-lg font-bold">{session.nameZh}</h3>
            <details>
              <summary className="cursor-pointer font-semibold">編輯場次</summary>
              <div className="mt-3 flex flex-col gap-3">
                <ItemForm kind="session" id={session.id} {...shared} submitLabel="儲存場次">
                  <TextPair name="name" label="名稱（含時間）" zh={session.nameZh} en={session.nameEn} required />
                  <NumberFields position={session.position} />
                </ItemForm>
                {!locked && (
                  <DeleteItem
                    kind="session"
                    id={session.id}
                    venueId={venueId}
                    label="場次"
                    warning="刪除場次會連同它的課程一起刪除，不能復原。"
                  />
                )}
              </div>
            </details>

            {session.courses.length === 0 && <p className="text-muted-foreground">這個場次還沒有課程。</p>}
            <ul className="flex flex-col gap-3">
              {session.courses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  session={session}
                  sessions={venue.sessions}
                  partnerLabel={courseLabel.get(partner.get(course.id) ?? "")}
                  locked={locked}
                  {...shared}
                />
              ))}
            </ul>

            {!locked && (
              <details>
                <summary className="cursor-pointer font-semibold">新增課程</summary>
                <div className="mt-3">
                  <ItemForm kind="course" parentId={session.id} {...shared} submitLabel="新增課程">
                    <CourseFields position={session.courses.length + 1} />
                  </ItemForm>
                </div>
              </details>
            )}
          </div>
        ))}
        {!locked && (
          <div className={cardClass}>
            <h3 className="text-lg font-bold">新增場次</h3>
            <ItemForm kind="session" parentId={venueId} {...shared} submitLabel="新增場次">
              <TextPair name="name" label="名稱（含時間）" required />
              <NumberFields position={venue.sessions.length + 1} />
            </ItemForm>
          </div>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="text-xl font-bold">成對課程</h2>
        <p className="text-sm text-muted-foreground">
          跨越連續兩個場次的課程，選了其中一堂就必須選另一堂。兩堂要在這個場地相鄰的兩個場次。
        </p>
        {pairs.length === 0 && <p>沒有成對課程。</p>}
        <ul className="flex flex-col gap-2">
          {pairs.map((pair) => (
            <li key={pair.firstCourseId} className="flex flex-wrap items-center gap-3">
              <span>
                {courseLabel.get(pair.firstCourseId)} ＋ {courseLabel.get(pair.secondCourseId)}
              </span>
              {!locked && (
                <form action={removeProgrammeCoursePair}>
                  <input type="hidden" name="firstCourseId" value={pair.firstCourseId} />
                  <input type="hidden" name="venueId" value={venueId} />
                  <button className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>拆開</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {!locked && courses.length >= 2 && (
          <form action={addProgrammeCoursePair} className="flex flex-col gap-3">
            <input type="hidden" name="conferenceId" value={conferenceId} />
            <input type="hidden" name="venueId" value={venueId} />
            <div className="grid gap-3 sm:grid-cols-2">
              {(["firstCourseId", "secondCourseId"] as const).map((name, index) => (
                <label key={name} className="flex flex-col gap-1">
                  <span className="font-semibold">{index === 0 ? "前一堂" : "後一堂"}</span>
                  <select name={name} required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      請選擇
                    </option>
                    {courses
                      .filter((course) => !partner.has(course.id))
                      .map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.label}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <button className={cn(buttonVariants({ variant: "outline" }), buttonClass, "self-start")}>
              設成成對課程
            </button>
          </form>
        )}
      </section>

      <OptionSection
        kind="lunch"
        title="午餐"
        noun="午餐"
        options={venue.lunchOptions}
        locked={locked}
        {...shared}
      />
      <OptionSection
        kind="activity"
        title="午后動態"
        noun="午后動態"
        options={venue.afternoonActivities}
        locked={locked}
        hint="只有設定了午后動態的場地，報名表才會出現這一題。"
        {...shared}
      />
    </main>
  );
}

function CourseCard({
  course,
  session,
  sessions,
  partnerLabel,
  locked,
  conferenceId,
  venueId,
}: {
  course: ProgrammeCourse;
  session: ProgrammeSession;
  sessions: ProgrammeSession[];
  partnerLabel: string | undefined;
  locked: boolean;
  conferenceId: string;
  venueId: string;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <span className="font-semibold">{course.nameZh}</span>
      <span className="text-sm text-muted-foreground">
        名額 {capacityLabel(course.capacity)}・教室 {course.classroom ?? "未定"}
        {partnerLabel && `・與「${partnerLabel}」成對`}
      </span>
      <details>
        <summary className="cursor-pointer font-semibold">編輯課程</summary>
        <div className="mt-3 flex flex-col gap-3">
          <ItemForm kind="course" id={course.id} conferenceId={conferenceId} venueId={venueId} submitLabel="儲存課程">
            <CourseFields course={course} position={course.position} />
            {/* 換時段只能在報名開放前。沒有換的時候照樣送出原本的場次。 */}
            {locked || sessions.length < 2 ? (
              <input type="hidden" name="parentId" value={session.id} />
            ) : (
              <label className="flex flex-col gap-1">
                <span className="font-semibold">場次</span>
                <select name="parentId" defaultValue={session.id} className={inputClass}>
                  {sessions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.nameZh}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </ItemForm>
          {!locked && (
            <DeleteItem
              kind="course"
              id={course.id}
              venueId={venueId}
              label="課程"
              warning={partnerLabel ? "刪除課程會一併拆開它所屬的成對課程，不能復原。" : undefined}
            />
          )}
        </div>
      </details>
    </li>
  );
}

/** 課程的欄位：課名、說明、教室、名額、排序。 */
function CourseFields({ course, position }: { course?: ProgrammeCourse; position: number }) {
  return (
    <>
      <TextPair name="name" label="課名" zh={course?.nameZh} en={course?.nameEn} required />
      <TextPair
        name="description"
        label="說明（講師等）"
        zh={course?.descriptionZh}
        en={course?.descriptionEn}
        multiline
      />
      <label className="flex flex-col gap-1">
        <span className="font-semibold">教室</span>
        <input name="classroom" defaultValue={course?.classroom ?? ""} maxLength={50} className={inputClass} />
        <span className="text-sm text-muted-foreground">
          只有後台看得到，報名者在前台看不到。不要寫在說明裡。換教室時記得一併調整名額。
        </span>
      </label>
      <NumberFields capacity={course?.capacity ?? null} position={position} />
    </>
  );
}

/** 午餐或午后動態：列表、編輯、刪除、新增。 */
function OptionSection({
  kind,
  title,
  noun,
  options,
  locked,
  hint,
  conferenceId,
  venueId,
}: {
  kind: ItemKind;
  title: string;
  noun: string;
  options: ProgrammeOption[];
  locked: boolean;
  hint?: string;
  conferenceId: string;
  venueId: string;
}) {
  const shared = { conferenceId, venueId };
  return (
    <section className={cardClass}>
      <h2 className="text-xl font-bold">{title}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {options.length === 0 && <p>沒有{noun}。</p>}
      <ul className="flex flex-col gap-3">
        {options.map((option) => (
          <li key={option.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <span className="font-semibold">{option.nameZh}</span>
            <span className="text-sm text-muted-foreground">名額 {capacityLabel(option.capacity)}</span>
            <details>
              <summary className="cursor-pointer font-semibold">編輯{noun}</summary>
              <div className="mt-3 flex flex-col gap-3">
                <ItemForm kind={kind} id={option.id} {...shared} submitLabel={`儲存${noun}`}>
                  <OptionFields option={option} position={option.position} />
                </ItemForm>
                {!locked && <DeleteItem kind={kind} id={option.id} venueId={venueId} label={noun} />}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {!locked && (
        <details>
          <summary className="cursor-pointer font-semibold">新增{noun}</summary>
          <div className="mt-3">
            <ItemForm kind={kind} parentId={venueId} {...shared} submitLabel={`新增${noun}`}>
              <OptionFields position={options.length + 1} />
            </ItemForm>
          </div>
        </details>
      )}
    </section>
  );
}

function OptionFields({ option, position }: { option?: ProgrammeOption; position: number }) {
  return (
    <>
      <TextPair name="name" label="名稱" zh={option?.nameZh} en={option?.nameEn} required />
      <TextPair name="description" label="說明" zh={option?.descriptionZh} en={option?.descriptionEn} multiline />
      <NumberFields capacity={option?.capacity ?? null} position={position} />
    </>
  );
}
