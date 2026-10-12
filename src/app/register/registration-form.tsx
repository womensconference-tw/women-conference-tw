"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import { messages, type Messages } from "@/lib/i18n/messages";
import {
  CHOIR_PARTS,
  SERVICES,
  courseIdsOf,
  extraInputOf,
  validateCourseChoices,
  validateExtraChoices,
  validateRegistration,
  type CourseChoices,
  type ExtraChoices,
  type Registration,
  type RegistrationError,
  type RegistrationErrors,
  type RegistrationField,
  type RegistrationInput,
} from "@/lib/registration";
import {
  searchWards,
  type LimitedOption,
  type RegistrationOptions,
  type SessionOption,
  type VenueOption,
} from "@/lib/registration-options";
import { cn } from "@/lib/utils";
import { register } from "./actions";

// 每一步有哪些欄位：按「下一步」時只檢查這一步，送出失敗時跳回第一個有錯的那一步。
const stepFields: RegistrationField[][] = [
  ["name", "phone", "email", "lineId", "stake", "ward"],
  ["venue"],
  ["courses"],
  ["lunch", "afternoonActivity", "services", "printedHandbook"],
  ["portraitConsent", "form"],
];
const lastStep = stepFields.length - 1;

// 每個輸入值的錯誤顯示在哪些欄位旁。換支聯會時支會會清空，所以兩者的錯誤一起收起。
const inputFields: Record<keyof RegistrationInput, RegistrationField[]> = {
  name: ["name"],
  phone: ["phone"],
  noPhone: ["phone"],
  email: ["email"],
  lineId: ["lineId"],
  stakeId: ["stake", "ward"],
  wardId: ["ward"],
  // 換場地時課程、午餐、午后動態會清空，所以它們的錯誤一起收起。
  venueId: ["venue", "courses", "lunch", "afternoonActivity"],
  courseIds: ["courses"],
  lunchOptionId: ["lunch"],
  afternoonActivityId: ["afternoonActivity"],
  choirPart: ["services"],
  services: ["services"],
  printedHandbook: ["printedHandbook"],
  portraitConsent: ["portraitConsent"],
};

const emptyInput: RegistrationInput = {
  name: "",
  phone: "",
  noPhone: false,
  email: "",
  lineId: "",
  stakeId: "",
  wardId: "",
  venueId: "",
  courseIds: [],
  lunchOptionId: null,
  afternoonActivityId: null,
  choirPart: null,
  services: [],
  printedHandbook: null,
  portraitConsent: false,
};

const noExtras = { lunchOptions: [], afternoonActivities: [] };

// 字級來自 globals.css 的主視覺設定。經過 cn() 的字級要寫成 text-(length:…)，見首頁的說明。
const actionClass =
  "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal text-center";
const textInputClass =
  "min-h-(--button-min-height) w-full rounded-lg border-2 border-input bg-background px-4 py-2 aria-invalid:border-destructive";
// 可點選的大選項：整塊都能點，選到的那個加粗框。
const choiceClass =
  "flex min-h-(--button-min-height) cursor-pointer items-center gap-3 rounded-lg border-2 border-input px-4 py-3 has-checked:border-primary has-checked:bg-muted has-checked:font-semibold";
const radioClass = "size-6 shrink-0 accent-primary";

/**
 * 報名表：基本資料 → 選場地 → 選課程 → 午餐與服務 → 肖像權同意與確認 → 完成頁。
 * 各步都在同一頁切換，回上一步不會清掉已填的資料；送出後在同一頁顯示完成頁。
 * 確認頁可以跳回任一步修改，改好後直接回到確認頁。
 * 不用下拉選單：支聯會、支會、場地、課程、午餐都是攤開的大選項。
 * 送出時有課程、午餐或午后動態剛額滿：回到那一步，那一項標成已額滿並取消選取，其他資料都保留。
 */
export function RegistrationForm({
  locale,
  options,
}: {
  locale: Locale;
  options: RegistrationOptions;
}) {
  const t = messages[locale];
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<RegistrationInput>(emptyInput);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [registration, setRegistration] = useState<Registration | null>(null);
  // 送出時才發現額滿的課程、午餐、午后動態，在新的名單讀進來之前先標成已額滿；讀取頁面時已額滿的由 options 標出。
  const [filledIds, setFilledIds] = useState<string[]>([]);
  // 每個場次選了哪門課或「不選課」。送出用的 input.courseIds 一律由這裡算出，兩者不會不一致。
  const [choices, setChoicesState] = useState<CourseChoices>({});
  // 午餐、午后動態、紙本手冊的選擇（含還沒選）。送出用的值同樣一律由這裡算出。
  const [extras, setExtrasState] = useState<ExtraChoices>({});
  // 到過確認頁之後，回到前面修改時可以直接回確認頁，不必一步一步按「下一步」。
  const [reviewed, setReviewed] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectedVenue = options.venues.find((option) => option.id === input.venueId);
  const sessions = selectedVenue?.sessions ?? [];

  // 送出失敗後頁面會重新讀取名單。新名單裡已經沒有她選的場地、支聯會、支會或課程時，
  // 一次全部取消選取並標出來，跳到最前面有問題的那一步；不必送出好幾次才一個一個發現。
  const [checkedOptions, setCheckedOptions] = useState(options);
  if (options !== checkedOptions) {
    setCheckedOptions(options);
    // 新名單已經帶著最新的額滿狀態；之後有人取消或加開名額，才會恢復可選。
    setFilledIds([]);
    const stale = staleSelections(input, choices, extras, options);
    setInput({
      ...input,
      ...stale.changes,
      courseIds: courseIdsOf(stale.choices),
      ...extraInputOf(stale.extras),
    });
    setChoicesState(stale.choices);
    setExtrasState(stale.extras);
    // 已經不用回答的題目（例如場地的午餐全刪了），送出時的錯誤一起收起，不留下看不到的錯誤。
    const merged = {
      ...Object.fromEntries(
        Object.entries(errors).filter(([field]) => !stale.dropped.includes(field as RegistrationField)),
      ),
      ...stale.errors,
    };
    setErrors(merged);
    if (Object.keys(stale.errors).length > 0) {
      setStep(stepFields.findIndex((fields) => fields.some((field) => merged[field])));
    }
  }

  // 改了哪個欄位，就收起那個欄位的錯誤；整張表單的錯誤（例如不在報名期間）留著。
  function update(changes: Partial<RegistrationInput>) {
    setInput((prev) => ({ ...prev, ...changes }));
    const touched = (Object.keys(changes) as (keyof RegistrationInput)[]).flatMap(
      (key) => inputFields[key],
    );
    setErrors((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([field]) => !touched.includes(field as RegistrationField)),
      ),
    );
  }

  // 同一欄位已經有比較具體的錯誤（例如送出後才知道「剛剛被訂完了」）時，保留那一句，
  // 不換成一般的「請選擇」。
  function withKnownErrors(next: RegistrationErrors): RegistrationErrors {
    return { ...next, ...pick(errors, Object.keys(next) as RegistrationField[]) };
  }

  function showErrors(next: RegistrationErrors) {
    setErrors(next);
    const first = stepFields.flat().find((field) => next[field]);
    if (!first) return;
    setStep(stepFields.findIndex((fields) => fields.includes(first)));
    // 等畫面換到有錯的那一步，再把游標移到第一個有錯的欄位。
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-field="${first}"][tabindex], [data-field="${first}"] :is(input:enabled, button, [tabindex])`,
        )
        ?.focus();
    });
  }

  function setChoices(next: CourseChoices) {
    setChoicesState(next);
    update({ courseIds: courseIdsOf(next) });
  }

  // 選某個場次的課；courseId 是 null 表示這個場次不選課。同一場次只有一個選擇，換掉原本的。
  function chooseCourse(session: SessionOption, courseId: string | null) {
    setChoices({ ...choices, [session.id]: courseId });
  }

  function setExtras(next: ExtraChoices) {
    setExtrasState(next);
    update(extraInputOf(next));
  }

  // 課程、午餐、午后動態屬於場地，換場地就要重新選；紙本手冊不受影響。
  function chooseVenue(venueId: string) {
    update({ venueId, courseIds: [], lunchOptionId: null, afternoonActivityId: null });
    setChoicesState({});
    setExtrasState(({ printedHandbook }) => ({ printedHandbook }));
  }

  function goTo(nextStep: number) {
    setStep(nextStep);
    if (nextStep === lastStep) setReviewed(true);
    window.scrollTo({ top: 0 });
  }

  function allErrors(): RegistrationErrors {
    return {
      ...validateRegistration(input),
      ...validateCourseChoices(choices, sessions),
      ...validateExtraChoices(extras, selectedVenue ?? noExtras),
    };
  }

  // 從確認頁回來修改後，直接回確認頁。改了場地等會影響後面幾步的選擇時，先跳到要重選的那一步。
  function backToReview() {
    const before = pick(allErrors(), stepFields.slice(0, lastStep).flat());
    if (Object.keys(before).length > 0) {
      showErrors(withKnownErrors(before));
      return;
    }
    setErrors({});
    goTo(lastStep);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const errorsNow = allErrors();
    // 平常只檢查這一步。最後送出時每一步都再檢查一次：她在後面幾步時，名單可能剛好變了
    // （例如新增了場次），有問題就跳回那一步。
    const stepErrors = step === lastStep ? errorsNow : pick(errorsNow, stepFields[step]);
    if (Object.keys(stepErrors).length > 0) {
      showErrors(withKnownErrors(stepErrors));
      return;
    }
    // 這一步已經沒問題；後面幾步的錯誤（例如送出後才發現場地不能選）留著，到那一步才看得到。
    setErrors((prev) => pick(prev, stepFields.slice(step + 1).flat()));
    if (step < lastStep) {
      goTo(step + 1);
      return;
    }
    startTransition(async () => {
      let result;
      try {
        result = await register(input);
      } catch {
        // 連線中斷或伺服器出錯：留在這一步、保留已填的資料，請她再按一次。
        showErrors({ form: "unknown" });
        return;
      }
      if (result.ok) {
        setRegistration(result.registration);
      } else {
        // 已經不能選的場地、支聯會、支會取消選取，等新的名單讀進來讓她重選；不然畫面上看起來還選著。
        const { venue, stake, ward } = result.errors;
        if (venue === "venueUnavailable") {
          setInput((prev) => ({
            ...prev,
            venueId: "",
            courseIds: [],
            lunchOptionId: null,
            afternoonActivityId: null,
          }));
          setChoicesState({});
          setExtrasState(({ printedHandbook }) => ({ printedHandbook }));
        }
        if (stake === "stakeUnavailable") setInput((prev) => ({ ...prev, stakeId: "", wardId: "" }));
        if (ward === "wardUnavailable") setInput((prev) => ({ ...prev, wardId: "" }));
        const filled = result.fullIds ?? [];
        setFilledIds((prev) => [...prev, ...filled]);
        if (result.errors.courses) {
          // 知道哪幾門額滿就只取消那幾門；不知道，或場次、課程有變動時，選了課的場次全部重選。
          const kept = Object.fromEntries(
            Object.entries(choices).filter(
              ([, id]) => id === null || (filled.length > 0 && !filled.includes(id)),
            ),
          );
          setChoicesState(kept);
          setInput((prev) => ({ ...prev, courseIds: courseIdsOf(kept) }));
        }
        // 額滿或已不能選的午餐、午后動態取消選取，請她重選。
        if (result.errors.lunch || result.errors.afternoonActivity) {
          const kept = { ...extras };
          if (result.errors.lunch) delete kept.lunch;
          if (result.errors.afternoonActivity) delete kept.afternoonActivity;
          setExtrasState(kept);
          setInput((prev) => ({ ...prev, ...extraInputOf(kept) }));
        }
        showErrors(result.errors);
      }
    });
  }

  if (registration) {
    return <Completed registration={registration} options={options} t={t} />;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-title leading-tight font-bold">{t.register.title}</h1>
        <p className="text-lead font-semibold">
          {t.register.stepProgress(step + 1, stepFields.length, t.register.stepTitles[step])}
        </p>
      </header>

      {/* 只有整張表單的錯誤（例如連線失敗）時，訊息已在送出按鈕上方，這裡不提「資料需要修改」。 */}
      {Object.keys(errors).some((field) => field !== "form") && (
        <p role="alert" className="rounded-lg border-2 border-destructive p-4 font-semibold text-destructive">
          {t.register.fixErrors}
        </p>
      )}

      {step === 0 && (
        <BasicDetails input={input} update={update} errors={errors} options={options} t={t} />
      )}

      {step === 1 && (
        <fieldset data-field="venue" className="flex flex-col gap-3">
          <legend className="mb-2 text-lead font-bold">{t.register.venueLabel}</legend>
          <p id="venue-hint">{t.register.venueHint}</p>
          <FieldError field="venue" errors={errors} t={t} />
          {options.venues.map((venue) => (
            <label key={venue.id} className={choiceClass}>
              <input
                type="radio"
                name="venue"
                className={radioClass}
                checked={input.venueId === venue.id}
                onChange={() => chooseVenue(venue.id)}
                {...errorAria("venue", errors, "venue-hint")}
              />
              {venue.name}
            </label>
          ))}
        </fieldset>
      )}

      {step === 2 && (
        <Courses
          sessions={sessions}
          filledIds={filledIds}
          choices={choices}
          choose={chooseCourse}
          errors={errors}
          t={t}
        />
      )}

      {step === 3 && (
        <LunchAndService
          venue={selectedVenue}
          filledIds={filledIds}
          extras={extras}
          setExtras={setExtras}
          input={input}
          update={update}
          errors={errors}
          t={t}
        />
      )}

      {step === lastStep && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-bold">{t.register.reviewHeading}</h2>
            <div className="rounded-lg border-2 border-card-outline p-4">
              <RegistrationDetails registration={input} options={options} t={t} />
            </div>
            <p>{t.register.reviewEditHint}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {t.register.editButtons.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setErrors({});
                    goTo(index);
                  }}
                  className={cn(buttonVariants({ variant: "outline" }), actionClass)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <fieldset data-field="portraitConsent" className="flex flex-col gap-3">
            <legend className="mb-2 text-heading font-bold">{t.register.portraitConsentHeading}</legend>
            <p>{t.register.portraitConsentText}</p>
            <FieldError field="portraitConsent" errors={errors} t={t} />
            <label className={choiceClass}>
              <input
                type="checkbox"
                className={radioClass}
                checked={input.portraitConsent}
                onChange={(event) => update({ portraitConsent: event.target.checked })}
                {...errorAria("portraitConsent", errors)}
              />
              {t.register.portraitConsentCheckbox}
            </label>
          </fieldset>
          <div data-field="form" tabIndex={-1}>
            <FieldError field="form" errors={errors} t={t} />
          </div>
        </>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={pending}
          className={cn(
            buttonVariants(),
            actionClass,
            "min-h-(--button-primary-min-height) text-(length:--text-lead-size) font-bold disabled:opacity-100",
          )}
        >
          {step < lastStep
            ? t.register.nextButton
            : pending
              ? t.register.submittingButton
              : t.register.submitButton}
        </button>
        {reviewed && step < lastStep && (
          <button
            type="button"
            onClick={backToReview}
            className={cn(buttonVariants({ variant: "outline" }), actionClass)}
          >
            {t.register.backToReviewButton}
          </button>
        )}
        {step > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setErrors({});
              goTo(step - 1);
            }}
            className={cn(buttonVariants({ variant: "outline" }), actionClass)}
          >
            {t.register.backButton}
          </button>
        )}
      </div>
    </form>
  );
}

function Courses({
  sessions,
  filledIds,
  choices,
  choose,
  errors,
  t,
}: {
  sessions: SessionOption[];
  filledIds: string[];
  choices: CourseChoices;
  choose: (session: SessionOption, courseId: string | null) => void;
  errors: RegistrationErrors;
  t: Messages;
}) {
  const isFull = (course: LimitedOption) => course.isFull || filledIds.includes(course.id);
  return (
    <div data-field="courses" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p id="courses-hint">{sessions.length > 0 ? t.register.coursesHint : t.register.noCourses}</p>
        <FieldError field="courses" errors={errors} t={t} />
      </div>
      {sessions.map((session) => (
        <fieldset key={session.id} className="flex flex-col gap-3">
          <legend className="mb-2 text-lead font-bold">{session.name}</legend>
          {session.courses.every(isFull) && (
            <p className="font-semibold">{t.register.sessionAllFull}</p>
          )}
          {session.courses.map((course) => (
            <LimitedChoice
              key={course.id}
              option={course}
              full={isFull(course)}
              name={`session-${session.id}`}
              checked={choices[session.id] === course.id}
              onChange={() => choose(session, course.id)}
              aria={errorAria("courses", errors, "courses-hint")}
              t={t}
            />
          ))}
          <label className={choiceClass}>
            <input
              type="radio"
              name={`session-${session.id}`}
              className={radioClass}
              checked={choices[session.id] === null}
              onChange={() => choose(session, null)}
              {...errorAria("courses", errors, "courses-hint")}
            />
            {t.register.noCourse}
          </label>
        </fieldset>
      ))}
    </div>
  );
}

/** 一個可能額滿的單選選項（課程、午餐、午后動態）：額滿時標示「已額滿」、不能選。 */
function LimitedChoice({
  option,
  full,
  name,
  checked,
  onChange,
  aria,
  t,
}: {
  option: LimitedOption;
  full: boolean;
  name: string;
  checked: boolean;
  onChange: () => void;
  aria: ReturnType<typeof errorAria>;
  t: Messages;
}) {
  return (
    <label
      className={cn(
        choiceClass,
        full && "cursor-not-allowed border-dashed bg-muted text-muted-foreground",
      )}
    >
      <input
        type="radio"
        name={name}
        className={radioClass}
        disabled={full}
        checked={checked}
        onChange={onChange}
        {...aria}
      />
      <span className="flex flex-1 flex-col">
        <span>{option.name}</span>
        {option.description && <span className="font-normal">{option.description}</span>}
      </span>
      {full && <span className="shrink-0 font-bold">{t.register.full}</span>}
    </label>
  );
}

/**
 * 午餐與服務：場地有午餐、午后動態時才問那一題，都要明確選一個（包括「不需要」「不參加」）；
 * 服務意願選填；紙本手冊要選要或不要。
 */
function LunchAndService({
  venue,
  filledIds,
  extras,
  setExtras,
  input,
  update,
  errors,
  t,
}: {
  venue: VenueOption | undefined;
  filledIds: string[];
  extras: ExtraChoices;
  setExtras: (next: ExtraChoices) => void;
  input: RegistrationInput;
  update: (changes: Partial<RegistrationInput>) => void;
  errors: RegistrationErrors;
  t: Messages;
}) {
  const isFull = (option: LimitedOption) => option.isFull || filledIds.includes(option.id);
  const lunchOptions = venue?.lunchOptions ?? [];
  const activities = venue?.afternoonActivities ?? [];
  const toggleService = (service: string, on: boolean) =>
    update({
      // 依固定順序存，確認頁與完成頁的列法才一致。
      services: SERVICES.filter((key) => (key === service ? on : input.services.includes(key))),
    });

  return (
    <>
      {lunchOptions.length > 0 && (
        <fieldset data-field="lunch" className="flex flex-col gap-3">
          <legend className="mb-2 text-lead font-bold">{t.register.lunchLabel}</legend>
          <p id="lunch-hint">{t.register.lunchHint}</p>
          <FieldError field="lunch" errors={errors} t={t} />
          {lunchOptions.map((lunch) => (
            <LimitedChoice
              key={lunch.id}
              option={lunch}
              full={isFull(lunch)}
              name="lunch"
              checked={extras.lunch === lunch.id}
              onChange={() => setExtras({ ...extras, lunch: lunch.id })}
              aria={errorAria("lunch", errors, "lunch-hint")}
              t={t}
            />
          ))}
          <label className={choiceClass}>
            <input
              type="radio"
              name="lunch"
              className={radioClass}
              checked={extras.lunch === null}
              onChange={() => setExtras({ ...extras, lunch: null })}
              {...errorAria("lunch", errors, "lunch-hint")}
            />
            {t.register.noLunch}
          </label>
        </fieldset>
      )}

      {activities.length > 0 && (
        <fieldset data-field="afternoonActivity" className="flex flex-col gap-3">
          <legend className="mb-2 text-lead font-bold">{t.register.afternoonActivityLabel}</legend>
          <p id="afternoonActivity-hint">{t.register.afternoonActivityHint}</p>
          <FieldError field="afternoonActivity" errors={errors} t={t} />
          {activities.map((activity) => (
            <LimitedChoice
              key={activity.id}
              option={activity}
              full={isFull(activity)}
              name="afternoonActivity"
              checked={extras.afternoonActivity === activity.id}
              onChange={() => setExtras({ ...extras, afternoonActivity: activity.id })}
              aria={errorAria("afternoonActivity", errors, "afternoonActivity-hint")}
              t={t}
            />
          ))}
          <label className={choiceClass}>
            <input
              type="radio"
              name="afternoonActivity"
              className={radioClass}
              checked={extras.afternoonActivity === null}
              onChange={() => setExtras({ ...extras, afternoonActivity: null })}
              {...errorAria("afternoonActivity", errors, "afternoonActivity-hint")}
            />
            {t.register.noAfternoonActivity}
          </label>
        </fieldset>
      )}

      <fieldset data-field="services" className="flex flex-col gap-3">
        <legend className="mb-2 text-lead font-bold">{t.register.servicesLabel}</legend>
        <p id="services-hint">{t.register.servicesHint}</p>
        <FieldError field="services" errors={errors} t={t} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-bold">{t.register.choirLabel}</legend>
          <p>{t.register.choirHint}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[null, ...CHOIR_PARTS].map((part) => (
              <label key={part ?? "none"} className={choiceClass}>
                <input
                  type="radio"
                  name="choirPart"
                  className={radioClass}
                  checked={input.choirPart === part}
                  onChange={() => update({ choirPart: part })}
                  {...errorAria("services", errors, "services-hint")}
                />
                {part ? t.register.choirParts[part] : t.register.noChoir}
              </label>
            ))}
          </div>
        </fieldset>
        {SERVICES.map((service) => (
          <label key={service} className={choiceClass}>
            <input
              type="checkbox"
              className={radioClass}
              checked={input.services.includes(service)}
              onChange={(event) => toggleService(service, event.target.checked)}
              {...errorAria("services", errors, "services-hint")}
            />
            {t.register.serviceNames[service]}
          </label>
        ))}
      </fieldset>

      <fieldset data-field="printedHandbook" className="flex flex-col gap-3">
        <legend className="mb-2 text-lead font-bold">{t.register.printedHandbookLabel}</legend>
        <FieldError field="printedHandbook" errors={errors} t={t} />
        {[true, false].map((wants) => (
          <label key={String(wants)} className={choiceClass}>
            <input
              type="radio"
              name="printedHandbook"
              className={radioClass}
              checked={extras.printedHandbook === wants}
              onChange={() => setExtras({ ...extras, printedHandbook: wants })}
              {...errorAria("printedHandbook", errors)}
            />
            {wants ? t.register.printedHandbookYes : t.register.printedHandbookNo}
          </label>
        ))}
      </fieldset>
    </>
  );
}

type StepProps = {
  input: RegistrationInput;
  update: (changes: Partial<RegistrationInput>) => void;
  errors: RegistrationErrors;
  options: RegistrationOptions;
  t: Messages;
};

function BasicDetails({ input, update, errors, options, t }: StepProps) {
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const stake = options.stakes.find((option) => option.id === input.stakeId);
  const matches = searchWards(options.stakes, query);

  return (
    <>
      <TextField
        field="name"
        label={t.register.nameLabel}
        value={input.name}
        onChange={(name) => update({ name })}
        autoComplete="name"
        errors={errors}
        t={t}
      />

      <div className="flex flex-col gap-3">
        {!input.noPhone && (
          <TextField
            field="phone"
            label={t.register.phoneLabel}
            hint={t.register.phoneHint}
            value={input.phone}
            onChange={(phone) => update({ phone })}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            errors={errors}
            t={t}
          />
        )}
        <label className={choiceClass}>
          <input
            type="checkbox"
            className={radioClass}
            checked={input.noPhone}
            onChange={(event) => update({ noPhone: event.target.checked, phone: "" })}
          />
          {t.register.noPhoneLabel}
        </label>
      </div>

      <TextField
        field="email"
        label={t.register.emailLabel}
        hint={t.register.emailHint}
        value={input.email}
        onChange={(email) => update({ email })}
        type="email"
        inputMode="email"
        autoComplete="email"
        errors={errors}
        t={t}
      />

      <TextField
        field="lineId"
        label={t.register.lineIdLabel}
        value={input.lineId}
        onChange={(lineId) => update({ lineId })}
        autoComplete="off"
        errors={errors}
        t={t}
      />

      <fieldset data-field="stake" className="flex flex-col gap-3">
        <legend className="mb-2 text-lead font-bold">{t.register.stakeLabel}</legend>
        <FieldError field="stake" errors={errors} t={t} />
        <div className="grid gap-3 sm:grid-cols-2">
          {options.stakes.map((option) => (
            <label key={option.id} className={choiceClass}>
              <input
                type="radio"
                name="stake"
                className={radioClass}
                checked={input.stakeId === option.id}
                onChange={() => update({ stakeId: option.id, wardId: "" })}
                {...errorAria("stake", errors)}
              />
              {option.name}
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={finding}
            onClick={() => setFinding(!finding)}
            className={cn(buttonVariants({ variant: "outline" }), actionClass)}
          >
            {t.register.findWardButton}
          </button>
          {finding && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-2">
                <span className="font-semibold">{t.register.findWardLabel}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  // 在搜尋框按 Enter 不送出表單。
                  onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
                  className={textInputClass}
                />
              </label>
              {query.trim() && matches.length === 0 && <p>{t.register.findWardNoMatch}</p>}
              {matches.length > 0 && (
                <ul className="flex flex-col gap-3" aria-live="polite">
                  {matches.map((match) => (
                    <li key={match.wardId}>
                      <button
                        type="button"
                        onClick={() => {
                          update({ stakeId: match.stakeId, wardId: match.wardId });
                          setFinding(false);
                          setQuery("");
                        }}
                        className={cn(buttonVariants({ variant: "outline" }), actionClass, "w-full justify-start text-left")}
                      >
                        {t.register.wardWithStake(match.wardName, match.stakeName)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </fieldset>

      {stake && (
        <fieldset data-field="ward" className="flex flex-col gap-3">
          <legend className="mb-2 text-lead font-bold">{t.register.wardLabel}</legend>
          <p>{t.register.wardsOf(stake.name)}</p>
          <FieldError field="ward" errors={errors} t={t} />
          <div className="grid gap-3 sm:grid-cols-2">
            {stake.wards.map((ward) => (
              <label key={ward.id} className={choiceClass}>
                <input
                  type="radio"
                  name="ward"
                  className={radioClass}
                  checked={input.wardId === ward.id}
                  onChange={() => update({ wardId: ward.id })}
                  {...errorAria("ward", errors)}
                />
                {ward.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {/* 還沒選支聯會時沒有支會可選；這時支會的錯誤改顯示在這裡。 */}
      {!stake && errors.ward && !errors.stake && (
        <div data-field="ward" tabIndex={-1}>
          <FieldError field="ward" errors={errors} t={t} />
        </div>
      )}
    </>
  );
}

function TextField({
  field,
  label,
  hint,
  value,
  onChange,
  type = "text",
  inputMode,
  autoComplete,
  errors,
  t,
}: {
  field: RegistrationField;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "tel" | "email";
  inputMode?: "text" | "tel" | "email";
  autoComplete?: string;
  errors: RegistrationErrors;
  t: Messages;
}) {
  const describedBy = [hint && `${field}-hint`, errors[field] && `${field}-error`]
    .filter(Boolean)
    .join(" ");
  return (
    <div data-field={field} className="flex flex-col gap-2">
      <label htmlFor={field} className="text-lead font-bold">
        {label}
      </label>
      {hint && <p id={`${field}-hint`}>{hint}</p>}
      <FieldError field={field} errors={errors} t={t} />
      <input
        id={field}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={textInputClass}
      />
    </div>
  );
}

function FieldError({
  field,
  errors,
  t,
}: {
  field: RegistrationField;
  errors: RegistrationErrors;
  t: Messages;
}) {
  const error = errors[field];
  if (!error) return null;
  return (
    <p id={`${field}-error`} className="font-semibold text-destructive">
      {t.register.errors[error]}
    </p>
  );
}

type Details = Pick<
  RegistrationInput,
  | "name"
  | "stakeId"
  | "wardId"
  | "venueId"
  | "courseIds"
  | "lunchOptionId"
  | "afternoonActivityId"
  | "services"
  | "printedHandbook"
> & {
  phone: string | null;
  email: string | null;
  lineId: string | null;
  choirPart: string | null;
  noPhone?: boolean;
};

/**
 * 報名資料的清單，確認步驟與完成頁共用。
 * 排得緊湊（標籤與內容同一行、支聯會併進支會），讓完成頁在手機上一個畫面就截得下。
 * 完成頁有報名編號時，編號取代「沒有電話」那一列；沒填的 Email、LINE ID 不列。
 * 場地沒有午餐、午后動態時不列那一列。
 */
function RegistrationDetails({
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
  const stake = options.stakes.find((option) => option.id === registration.stakeId);
  const ward = stake?.wards.find((option) => option.id === registration.wardId);
  const venue = options.venues.find((option) => option.id === registration.venueId);
  const done = registrationNumber !== undefined;
  const email = registration.email?.trim();
  const lineId = registration.lineId?.trim();
  const rows: { label: string; value: string }[] = [
    { label: t.register.nameLabel, value: registration.name.trim() },
    ...(registrationNumber
      ? []
      : [
          {
            label: t.register.phoneLabel,
            value: registration.noPhone || !registration.phone ? t.register.noPhone : registration.phone,
          },
        ]),
    ...(email || !done ? [{ label: t.register.emailShortLabel, value: email || t.register.notProvided }] : []),
    ...(lineId || !done ? [{ label: t.register.lineIdShortLabel, value: lineId || t.register.notProvided }] : []),
    {
      label: t.register.wardLabel,
      value: stake && ward ? t.register.wardWithStake(ward.name, stake.name) : "",
    },
    { label: t.register.venueLabel, value: venue?.name ?? "" },
  ];
  // 與報名表的步驟同一個順序：課程之後才是午餐與服務。
  const extraRows: { label: string; value: string }[] = [
    ...(venue && venue.lunchOptions.length > 0
      ? [
          {
            label: t.register.lunchLabel,
            value:
              venue.lunchOptions.find((lunch) => lunch.id === registration.lunchOptionId)?.name ??
              t.register.noLunch,
          },
        ]
      : []),
    ...(venue && venue.afternoonActivities.length > 0
      ? [
          {
            label: t.register.afternoonActivityLabel,
            value:
              venue.afternoonActivities.find(
                (activity) => activity.id === registration.afternoonActivityId,
              )?.name ?? t.register.noAfternoonActivity,
          },
        ]
      : []),
    { label: t.register.servicesShortLabel, value: serviceSummary(registration, t) },
    {
      label: t.register.printedHandbookLabel,
      value: registration.printedHandbook
        ? t.register.printedHandbookShortYes
        : t.register.printedHandbookShortNo,
    },
  ];
  const courses = (venue?.sessions ?? []).map((session) => ({
    session: session.name,
    course:
      session.courses.find((course) => registration.courseIds.includes(course.id))?.name ??
      t.register.noCourse,
  }));
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

function Completed({
  registration,
  options,
  t,
}: {
  registration: Registration;
  options: RegistrationOptions;
  t: Messages;
}) {
  const ref = useRef<HTMLElement>(null);
  // 送出後把報名資料的框捲到畫面最上面，手機一個畫面就能截圖。截圖提示放在框下面，不佔截圖的空間。
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <section ref={ref} className="flex scroll-mt-3 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border-4 border-primary px-4 py-3">
        <h1 className="text-heading leading-tight font-bold">{t.register.done.heading}</h1>
        <RegistrationDetails
          registration={registration}
          registrationNumber={registration.registrationNumber}
          options={options}
          t={t}
        />
        {registration.registrationNumber && (
          <p className="leading-snug">{t.register.done.registrationNumberHint}</p>
        )}
      </div>
      {!registration.email && (
        <p className="rounded-lg bg-muted px-4 py-3 font-semibold leading-snug">
          {t.register.done.screenshotHint}
        </p>
      )}
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }), actionClass)}>
        {t.register.homeButton}
      </Link>
    </section>
  );
}

/** 服務意願列成一行，例如「即席唱詩班（女高音）、當天接待」；都沒有時是「無」。 */
function serviceSummary(registration: Pick<Details, "choirPart" | "services">, t: Messages): string {
  const part = CHOIR_PARTS.find((key) => key === registration.choirPart);
  const names = [
    ...(part ? [t.register.choirWithPart(t.register.choirParts[part])] : []),
    ...SERVICES.filter((key) => registration.services.includes(key)).map(
      (key) => t.register.serviceNames[key],
    ),
  ];
  return names.length > 0 ? names.join(t.register.serviceListSeparator) : t.register.noServices;
}

/**
 * 已經不在名單裡或剛額滿的選擇：要清掉的值、整理後的選課與午餐等選擇、要顯示的錯誤，
 * 以及已經不用回答、錯誤要收起的題目（場地的午餐或午后動態全被刪掉時）。
 * 剛額滿的選擇也取消選取並標出來，不必等再次送出才被拒絕。
 * 選的課已經不在原本那個場次（被刪除，或被管理員移到別的場次）時，清掉那個場次的選擇請她重選，
 * 不會不知不覺換到別的時段。
 */
function staleSelections(
  input: RegistrationInput,
  choices: CourseChoices,
  extras: ExtraChoices,
  options: RegistrationOptions,
): {
  changes: Partial<RegistrationInput>;
  choices: CourseChoices;
  extras: ExtraChoices;
  errors: RegistrationErrors;
  dropped: RegistrationField[];
} {
  const changes: Partial<RegistrationInput> = {};
  const errors: RegistrationErrors = {};
  const dropped: RegistrationField[] = [];
  const stake = options.stakes.find((option) => option.id === input.stakeId);
  if (input.stakeId && !stake) {
    changes.stakeId = "";
    changes.wardId = "";
    errors.stake = "stakeUnavailable";
  } else if (input.wardId && !stake?.wards.some((ward) => ward.id === input.wardId)) {
    changes.wardId = "";
    errors.ward = "wardUnavailable";
  }
  if (input.venueId && !options.venues.some((venue) => venue.id === input.venueId)) {
    changes.venueId = "";
    errors.venue = "venueUnavailable";
    return {
      changes,
      choices: {},
      extras: { printedHandbook: extras.printedHandbook },
      errors,
      dropped,
    };
  }
  const venue = options.venues.find((option) => option.id === input.venueId);
  const keptExtras = { ...extras };
  const checkExtra = (
    key: "lunch" | "afternoonActivity",
    options: LimitedOption[],
    unavailable: RegistrationError,
    full: RegistrationError,
  ) => {
    const choice = extras[key];
    if (venue && options.length === 0) {
      delete keptExtras[key];
      dropped.push(key);
      return;
    }
    if (!choice) return;
    const option = options.find((candidate) => candidate.id === choice);
    if (!option || option.isFull) {
      delete keptExtras[key];
      errors[key] = option ? full : unavailable;
    }
  };
  checkExtra("lunch", venue?.lunchOptions ?? [], "lunchUnavailable", "lunchFull");
  checkExtra(
    "afternoonActivity",
    venue?.afternoonActivities ?? [],
    "afternoonActivityUnavailable",
    "afternoonActivityFull",
  );
  const sessions = venue?.sessions ?? [];
  const kept: CourseChoices = {};
  for (const [sessionId, courseId] of Object.entries(choices)) {
    const course = sessions
      .find((option) => option.id === sessionId)
      ?.courses.find((option) => option.id === courseId);
    if (courseId === null ? sessions.some((option) => option.id === sessionId) : course && !course.isFull) {
      kept[sessionId] = courseId;
    } else if (courseId !== null) {
      errors.courses = course ? "courseFull" : "courseRequired";
    }
  }
  return { changes, choices: kept, extras: keptExtras, errors, dropped };
}


/** 讓輔助科技從選項讀到錯誤：標成有錯，並連到錯誤訊息（與其他說明文字）。 */
function errorAria(field: RegistrationField, errors: RegistrationErrors, ...describedBy: string[]) {
  const ids = errors[field] ? [...describedBy, `${field}-error`] : describedBy;
  return {
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
  };
}

function pick(errors: RegistrationErrors, fields: RegistrationField[]): RegistrationErrors {
  return Object.fromEntries(
    fields.filter((field) => errors[field]).map((field) => [field, errors[field]]),
  );
}
