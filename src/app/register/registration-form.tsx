"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { RegistrationDetails } from "@/components/registration-details";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import { messages, type Messages } from "@/lib/i18n/messages";
import {
  CHOIR_PARTS,
  SERVICES,
  changesOf,
  choicesAfterVenueChange,
  choicesOf,
  chooseCourse,
  courseIdsOf,
  extraInputOf,
  nextRegistrationInput,
  validateCourseChoices,
  validateExtraChoices,
  validateRegistration,
  type CourseChoices,
  type ExtraChoices,
  type FoundRegistration,
  type LookupInput,
  type Registration,
  type RegistrationErrors,
  type RegistrationField,
  type RegistrationInput,
} from "@/lib/registration";
import { staleSelections } from "@/lib/stale-selections";
import { settled, useSubmissionKey } from "@/lib/submission-key";
import {
  searchWards,
  type CourseOption,
  type LimitedOption,
  type RegistrationOptions,
  type SessionOption,
  type VenueOption,
} from "@/lib/registration-options";
import { cn } from "@/lib/utils";
import { updateMine } from "../lookup/actions";
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

/**
 * 修改報名時要改的那一筆、查到它時用的姓名與電話（或報名編號，修改時再比對一次），
 * 以及離開修改畫面時要做的事（改好了會帶著修改後的報名）。
 */
export type EditTarget = {
  registration: FoundRegistration;
  lookup: LookupInput;
  onClose: (updated?: Registration) => void;
};

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
 * 有 edit 時是修改報名：同樣的步驟與確認頁，一開始就停在確認頁、填好她原本的資料；
 * 姓名、支會不能改，不再問肖像權。她原本已佔的課程、午餐、午后動態就算額滿也照樣可選。
 * 各步都在同一頁切換，回上一步不會清掉已填的資料；送出後在同一頁顯示完成頁。
 * 確認頁可以跳回任一步修改，改好後直接回到確認頁。
 * 不用下拉選單：支聯會、支會、場地、課程、午餐都是攤開的大選項。
 * 送出時有課程、午餐或午后動態剛額滿：回到那一步，那一項標成已額滿並取消選取，其他資料都保留。
 * 代報（ADR 0003）：forOthers 時第一步多一句說明；完成頁可以「再幫一位報名」，
 * 下一位帶入電話、Email、支聯會、支會、場地，其他清空，從第一步重新填。
 */
export function RegistrationForm({
  locale,
  options,
  edit,
  forOthers = false,
}: {
  locale: Locale;
  options: RegistrationOptions;
  edit?: EditTarget;
  /** 從首頁「幫家人或朋友報名」進來。 */
  forOthers?: boolean;
}) {
  const t = edit ? editMessages(messages[locale]) : messages[locale];
  // 修改時一開始的資料：她原本的報名。只在第一次算，之後由她修改。
  const [initial] = useState(() => (edit ? initialEditState(edit.registration, options) : null));
  const [step, setStep] = useState(edit ? lastStep : 0);
  const [input, setInput] = useState<RegistrationInput>(initial?.input ?? emptyInput);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [registration, setRegistration] = useState<Registration | null>(null);
  // 送出時才發現額滿的課程、午餐、午后動態，在新的名單讀進來之前先標成已額滿；讀取頁面時已額滿的由 options 標出。
  const [filledIds, setFilledIds] = useState<string[]>([]);
  // 每個場次選了哪門課或「不選課」。送出用的 input.courseIds 一律由這裡算出，兩者不會不一致。
  const [choices, setChoicesState] = useState<CourseChoices>(initial?.choices.courses ?? {});
  // 午餐、午后動態、紙本手冊的選擇（含還沒選）。送出用的值同樣一律由這裡算出。
  const [extras, setExtrasState] = useState<ExtraChoices>(initial?.choices.extras ?? {});
  // 到過確認頁之後，回到前面修改時可以直接回確認頁，不必一步一步按「下一步」。
  const [reviewed, setReviewed] = useState(Boolean(edit));
  // 按了「再幫一位報名」：第一步說明哪些資料是從上一位帶過來的。
  const [another, setAnother] = useState(false);
  const [pending, startTransition] = useTransition();
  // 回應斷掉後她再按一次，沿用同一個送出編號，不會多一筆報名、多寄一封信。
  const submission = useSubmissionKey();
  const selectedVenue = options.venues.find((option) => option.id === input.venueId);
  const sessions = selectedVenue?.sessions ?? [];
  // 修改時她原本已佔的選項：名額仍是她的，就算額滿也照樣可選（ADR 0006）。
  const [heldIds] = useState(() => (edit ? heldIdsOf(edit.registration) : []));
  const isFull = (option: LimitedOption) =>
    (option.isFull && !heldIds.includes(option.id)) || filledIds.includes(option.id);

  // 送出失敗後頁面會重新讀取名單。新名單裡已經沒有她選的場地、支聯會、支會或課程時，
  // 一次全部取消選取並標出來，跳到最前面有問題的那一步；不必送出好幾次才一個一個發現。
  const [checkedOptions, setCheckedOptions] = useState(options);
  if (options !== checkedOptions) {
    setCheckedOptions(options);
    // 新名單已經帶著最新的額滿狀態；之後有人取消或加開名額，才會恢復可選。
    setFilledIds([]);
    const stale = staleSelections(input, choices, extras, options, heldIds, Boolean(edit));
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

  // 選某個場次的課；courseId 是 null 表示這個場次不選課。成對課程一起選、一起取消（見 chooseCourse）。
  function chooseSessionCourse(session: SessionOption, courseId: string | null) {
    setChoices(chooseCourse(choices, sessions, session.id, courseId));
  }

  function setExtras(next: ExtraChoices) {
    setExtrasState(next);
    update(extraInputOf(next));
  }

  // 課程、午餐、午后動態屬於場地，換場地就要重新選；紙本手冊不受影響。
  function chooseVenue(venueId: string) {
    const next = choicesAfterVenueChange({ courses: choices, extras });
    update({ venueId, courseIds: [], lunchOptionId: null, afternoonActivityId: null });
    setChoicesState(next.courses);
    setExtrasState(next.extras);
  }

  function goTo(nextStep: number) {
    setStep(nextStep);
    if (nextStep === lastStep) setReviewed(true);
    window.scrollTo({ top: 0 });
  }

  // 再幫一位報名：上一位已經存下，表單換成下一位的，從第一步開始。
  function startAnother() {
    setInput(nextRegistrationInput(input));
    setChoicesState({});
    setExtrasState({});
    setErrors({});
    setRegistration(null);
    setReviewed(false);
    setAnother(true);
    goTo(0);
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
        if (edit) {
          const changes = changesOf(input);
          result = await updateMine({
            registrationId: edit.registration.id,
            lookup: edit.lookup,
            changes,
            submissionKey: submission.keyFor({ registrationId: edit.registration.id, changes }),
          });
        } else {
          result = await register(input, submission.keyFor(input));
        }
      } catch {
        // 連線中斷或伺服器出錯：留在這一步、保留已填的資料，請她再按一次。
        showErrors({ form: "unknown" });
        return;
      }
      if (settled(result)) submission.answered();
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
          const next = choicesAfterVenueChange({ courses: choices, extras });
          setChoicesState(next.courses);
          setExtrasState(next.extras);
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
    return (
      <Completed
        registration={registration}
        stakeAndWard={
          edit && { stakeName: edit.registration.stakeName, wardName: edit.registration.wardName }
        }
        onBack={edit && (() => edit.onClose(registration))}
        onAnother={edit ? undefined : startAnother}
        options={options}
        t={t}
      />
    );
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

      {step === 0 && !edit && (another || forOthers) && (
        <p className="rounded-lg bg-muted px-4 py-3 font-semibold leading-snug">
          {another ? t.register.anotherIntro : t.register.proxyIntro}
        </p>
      )}

      {step === 0 &&
        (edit ? (
          <ContactDetails input={input} update={update} errors={errors} registration={edit.registration} t={t} />
        ) : (
          <BasicDetails input={input} update={update} errors={errors} options={options} t={t} />
        ))}

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
          isFull={isFull}
          choices={choices}
          choose={chooseSessionCourse}
          errors={errors}
          t={t}
        />
      )}

      {step === 3 && (
        <LunchAndService
          venue={selectedVenue}
          isFull={isFull}
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
              {/* 修改時她的支聯會、支會可能已停用、不在選項裡，用查詢時拿到的名稱；沒有電話的人列出報名編號。 */}
              <RegistrationDetails
                registration={
                  edit
                    ? { ...input, stakeName: edit.registration.stakeName, wardName: edit.registration.wardName }
                    : input
                }
                registrationNumber={edit ? edit.registration.registrationNumber : undefined}
                options={options}
                t={t}
              />
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
          {/* 修改時肖像權已經同意過，不再問。 */}
          {!edit && (
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
          )}
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
        {edit && (
          <button
            type="button"
            disabled={pending}
            onClick={() => edit.onClose()}
            className={cn(buttonVariants({ variant: "outline" }), actionClass)}
          >
            {t.edit.cancelButton}
          </button>
        )}
      </div>
    </form>
  );
}

function Courses({
  sessions,
  isFull,
  choices,
  choose,
  errors,
  t,
}: {
  sessions: SessionOption[];
  isFull: (option: LimitedOption) => boolean;
  choices: CourseChoices;
  choose: (session: SessionOption, courseId: string | null) => void;
  errors: RegistrationErrors;
  t: Messages;
}) {
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
              note={pairNote(course, sessions, t)}
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

/** 成對課程的說明：選這堂會一起選哪個場次的哪門課。不是成對課程時沒有。 */
function pairNote(course: CourseOption, sessions: SessionOption[], t: Messages): string | undefined {
  const session = sessions.find((option) => option.id === course.pairedWith?.sessionId);
  const partner = session?.courses.find((option) => option.id === course.pairedWith?.courseId);
  return session && partner ? t.register.pairedWith(session.name, partner.name) : undefined;
}

/** 一個可能額滿的單選選項（課程、午餐、午后動態）：額滿時標示「已額滿」、不能選。note 是額外的說明。 */
function LimitedChoice({
  option,
  full,
  name,
  checked,
  onChange,
  aria,
  note,
  t,
}: {
  option: LimitedOption;
  full: boolean;
  name: string;
  checked: boolean;
  onChange: () => void;
  aria: ReturnType<typeof errorAria>;
  note?: string;
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
        {note && <span className="font-normal">{note}</span>}
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
  isFull,
  extras,
  setExtras,
  input,
  update,
  errors,
  t,
}: {
  venue: VenueOption | undefined;
  isFull: (option: LimitedOption) => boolean;
  extras: ExtraChoices;
  setExtras: (next: ExtraChoices) => void;
  input: RegistrationInput;
  update: (changes: Partial<RegistrationInput>) => void;
  errors: RegistrationErrors;
  t: Messages;
}) {
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

/**
 * 修改報名的第一步：只能改聯絡資料。姓名、支會列出來但不能改；
 * 沒有電話的人不問電話（報名編號列在確認頁），有電話的人不能改成沒有電話。
 */
function ContactDetails({
  input,
  update,
  errors,
  registration,
  t,
}: Omit<StepProps, "options"> & { registration: FoundRegistration }) {
  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg bg-muted px-4 py-3">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 leading-snug">
          <dt className="font-semibold">{t.register.nameLabel}</dt>
          <dd className="min-w-0 wrap-anywhere">{registration.name}</dd>
          <dt className="font-semibold">{t.register.wardLabel}</dt>
          <dd className="min-w-0 wrap-anywhere">
            {t.register.wardWithStake(registration.wardName, registration.stakeName)}
          </dd>
        </dl>
        <p>{t.edit.fixedDetailsHint}</p>
      </div>

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

function Completed({
  registration,
  stakeAndWard,
  onBack,
  onAnother,
  options,
  t,
}: {
  registration: Registration;
  /** 修改時查詢拿到的支聯會、支會名稱：它們可能已停用，不在選項裡。 */
  stakeAndWard?: { stakeName: string; wardName: string };
  /** 修改時回到查詢結果。 */
  onBack?: () => void;
  /** 再幫一位報名（修改時沒有）。 */
  onAnother?: () => void;
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
          registration={{ ...registration, ...stakeAndWard }}
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
      {onBack && (
        <button type="button" onClick={onBack} className={cn(buttonVariants(), actionClass, "font-bold")}>
          {t.edit.backToLookupButton}
        </button>
      )}
      {onAnother && (
        <button type="button" onClick={onAnother} className={cn(buttonVariants(), actionClass, "font-bold")}>
          {t.register.done.anotherButton}
        </button>
      )}
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }), actionClass)}>
        {t.register.homeButton}
      </Link>
    </section>
  );
}

/** 修改報名時表單一開始的資料：她原本的報名，選課與午餐等選擇由它算出。 */
function initialEditState(registration: FoundRegistration, options: RegistrationOptions) {
  const venue = options.venues.find((option) => option.id === registration.venueId);
  const choices = choicesOf(registration, venue);
  const input: RegistrationInput = {
    name: registration.name,
    phone: registration.phone ?? "",
    noPhone: registration.phone === null,
    email: registration.email ?? "",
    lineId: registration.lineId ?? "",
    stakeId: registration.stakeId,
    wardId: registration.wardId,
    venueId: registration.venueId,
    courseIds: courseIdsOf(choices.courses),
    ...extraInputOf(choices.extras),
    choirPart: registration.choirPart,
    services: registration.services,
    portraitConsent: true,
  };
  return { input, choices };
}

/** 她原本已佔的課程、午餐、午后動態。 */
function heldIdsOf(registration: Registration): string[] {
  return [registration.lunchOptionId, registration.afternoonActivityId, ...registration.courseIds].filter(
    (id): id is string => id !== null,
  );
}

/** 修改報名的文字：和報名表大致相同，標題、步驟名稱、按鈕與幾則錯誤訊息換成修改用的。 */
function editMessages(t: Messages): Messages {
  return {
    ...t,
    register: {
      ...t.register,
      title: t.edit.title,
      stepTitles: t.edit.stepTitles,
      editButtons: t.edit.editButtons,
      reviewHeading: t.edit.reviewHeading,
      submitButton: t.edit.submitButton,
      errors: { ...t.register.errors, ...t.edit.errors },
      done: { ...t.register.done, heading: t.edit.doneHeading },
    },
  };
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
