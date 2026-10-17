"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";
import type { RegistrationForEdit } from "@/lib/registration-list";
import {
  CHOIR_PARTS,
  REGISTRANT_ROLE_LABELS,
  REGISTRANT_ROLES,
  SERVICES,
  choicesAfterVenueChange,
  choicesOf,
  chooseCourse,
  courseIdsOf,
  validateCourseChoices,
  type CourseChoices,
  type StaffRegistrationError,
  type StaffRegistrationErrors,
  type StaffRegistrationField,
  type StaffRegistrationInput,
} from "@/lib/registration";
import type { LimitedOption, RegistrationOptions } from "@/lib/registration-options";
import { cn } from "@/lib/utils";
import { Field } from "../../fields";
import { alertClass, buttonClass, inputClass } from "../../ui";
import { addRegistration, editRegistration, type StaffFormResult } from "./actions";

// 唱詩班聲部、服務意願的名稱和前台報名表一樣。
const zh = messages.zh.register;

// 錯誤訊息大多沿用前台報名表的；對報名者說的幾句改成對總管理員說，後台才有的另外寫。
const ERRORS: Record<StaffRegistrationError, string> = {
  ...zh.errors,
  phoneRequired: "請填寫電話，或勾選「沒有電話」。",
  venueUnavailable: "這個場地已經不能選了（可能不是目前年度），請重新選擇。",
  courseRequired: "課程不在所選的場地，或同一場次選了兩門，請重新選擇。",
  portraitConsentRequired: "報名者要同意肖像權才能報名。",
  notFound: "找不到這筆報名，可能不是目前年度的報名。",
  cancelled: "這筆報名已經取消，不能修改。",
  unknown: "系統暫時出了問題，沒有存下。請稍後再試一次。",
  roleInvalid: "請選擇身分類別。",
  notAllowed: "只有總管理員能新增、修改、取消報名。",
};

const emptyInput: StaffRegistrationInput = {
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
  role: "attendee",
};

/** 修改時一開始的內容：她存下的報名。姓名、支聯會、支會不能改，只用來顯示。 */
function inputOf(registration: RegistrationForEdit): StaffRegistrationInput {
  return {
    ...emptyInput,
    name: registration.name,
    phone: registration.phone ?? "",
    noPhone: registration.phone === null,
    email: registration.email ?? "",
    lineId: registration.lineId ?? "",
    stakeId: registration.stakeId,
    wardId: registration.wardId,
    venueId: registration.venueId,
    courseIds: registration.courseIds,
    lunchOptionId: registration.lunchOptionId,
    afternoonActivityId: registration.afternoonActivityId,
    choirPart: registration.choirPart,
    services: registration.services,
    printedHandbook: registration.printedHandbook,
    portraitConsent: true,
    role: registration.role,
  };
}

/**
 * 後台新增、修改報名的表單（只有總管理員看得到）。所有欄位攤在同一頁，和前台同一套檢查由報名服務負責。
 * 已額滿的選項照樣可選；送出時資料庫回報額滿，先跳出提示列出「已報／名額」，按「確定加入」才帶確認旗標再送一次。
 * 修改時姓名、支聯會、支會不能改，有沒有電話也不能改（和前台修改相同）。
 */
export function RegistrationEditor({
  options,
  registration,
}: {
  options: RegistrationOptions;
  registration?: RegistrationForEdit;
}) {
  const router = useRouter();
  const [input, setInput] = useState<StaffRegistrationInput>(() =>
    registration ? inputOf(registration) : emptyInput,
  );
  const [choices, setChoices] = useState<CourseChoices>(() =>
    registration
      ? choicesOf(registration, options.venues.find((venue) => venue.id === registration.venueId)).courses
      : {},
  );
  const [errors, setErrors] = useState<StaffRegistrationErrors>({});
  const [fullOptions, setFullOptions] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  const venue = options.venues.find((option) => option.id === input.venueId);
  const sessions = venue?.sessions ?? [];
  const stake = options.stakes.find((option) => option.id === input.stakeId);
  // 她原本已佔的選項不算額滿（ADR 0006）。
  const held = new Set(
    registration
      ? [...registration.courseIds, registration.lunchOptionId, registration.afternoonActivityId].filter(
          (id): id is string => id !== null,
        )
      : [],
  );
  const label = (option: LimitedOption) =>
    option.isFull && !held.has(option.id) ? `${option.name}（已額滿）` : option.name;

  function update(changes: Partial<StaffRegistrationInput>) {
    setInput((prev) => ({ ...prev, ...changes }));
  }

  // 換場地時課程、午餐、午后動態都屬於舊場地，清空（和前台相同）。
  // 後台的場次選單沒選就顯示「不選課」，所以清空的場次就是不選課，不必像前台一樣要求每個場次都回答。
  function chooseVenue(venueId: string) {
    setChoices(choicesAfterVenueChange({ courses: choices, extras: {} }).courses);
    update({ venueId, courseIds: [], lunchOptionId: null, afternoonActivityId: null });
  }

  // 成對課程一起選、一起取消（見 chooseCourse）；換掉一堂時另一堂的場次清空，也就是不選課。
  function chooseSessionCourse(sessionId: string, courseId: string | null) {
    const next = chooseCourse(choices, sessions, sessionId, courseId);
    setChoices(next);
    update({ courseIds: courseIdsOf(next) });
  }

  function submit(confirmFull: boolean) {
    const pairErrors = validateCourseChoices(choices, sessions);
    if (pairErrors.courses === "coursePairRequired") {
      setErrors(pairErrors);
      return;
    }
    startTransition(async () => {
      let result: StaffFormResult;
      try {
        result = registration
          ? await editRegistration(registration.id, input, confirmFull)
          : await addRegistration(input, confirmFull);
      } catch {
        setErrors({ form: "unknown" });
        return;
      }
      if (result.ok) {
        router.push(`/staff/registrations?done=${registration ? "updated" : "added"}`);
        return;
      }
      if (result.needsConfirmation) {
        setErrors({});
        setFullOptions(result.fullOptions ?? []);
        dialog.current?.showModal();
        return;
      }
      setErrors(result.errors);
      window.scrollTo({ top: 0 });
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!pending) submit(false);
  }

  function confirmFull() {
    dialog.current?.close();
    submit(true);
  }

  const errorList = Object.entries(errors) as [StaffRegistrationField, StaffRegistrationError][];

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-6">
      {errorList.length > 0 && (
        <div role="alert" className={alertClass}>
          <p>沒有存下，請修改：</p>
          <ul className="list-disc pl-6">
            {errorList.map(([field, error]) => (
              <li key={field}>{ERRORS[error]}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="基本資料">
        {registration ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-semibold">姓名</dt>
            <dd>{registration.name}</dd>
            <dt className="font-semibold">支聯會／支會</dt>
            <dd>
              {registration.stakeName}／{registration.wardName}
            </dd>
            {registration.registrationNumber && (
              <>
                <dt className="font-semibold">報名編號</dt>
                <dd>{registration.registrationNumber}</dd>
              </>
            )}
          </dl>
        ) : (
          <>
            <Field label="姓名" required>
              <input
                value={input.name}
                onChange={(event) => update({ name: event.target.value })}
                aria-invalid={errors.name ? true : undefined}
                autoComplete="off"
                className={inputClass}
              />
            </Field>
            <Field label="支聯會" required>
              <select
                value={input.stakeId}
                onChange={(event) => update({ stakeId: event.target.value, wardId: "" })}
                aria-invalid={errors.stake ? true : undefined}
                className={inputClass}
              >
                <option value="">請選擇</option>
                {options.stakes.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="支會" required>
              <select
                value={input.wardId}
                onChange={(event) => update({ wardId: event.target.value })}
                aria-invalid={errors.ward ? true : undefined}
                disabled={!stake}
                className={inputClass}
              >
                <option value="">{stake ? "請選擇" : "請先選支聯會"}</option>
                {stake?.wards.map((ward) => (
                  <option key={ward.id} value={ward.id}>
                    {ward.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        {!(registration && input.noPhone) && (
          <Field label="電話" required={!input.noPhone}>
            <input
              type="tel"
              value={input.phone}
              onChange={(event) => update({ phone: event.target.value })}
              disabled={input.noPhone}
              aria-invalid={errors.phone ? true : undefined}
              autoComplete="off"
              className={inputClass}
            />
          </Field>
        )}
        {!registration && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={input.noPhone}
              onChange={(event) => update({ noPhone: event.target.checked, phone: "" })}
              className="size-5"
            />
            沒有電話（系統會發 6 碼報名編號）
          </label>
        )}
        <Field label="Email">
          <input
            type="email"
            value={input.email}
            onChange={(event) => update({ email: event.target.value })}
            aria-invalid={errors.email ? true : undefined}
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        <Field label="LINE ID">
          <input
            value={input.lineId}
            onChange={(event) => update({ lineId: event.target.value })}
            aria-invalid={errors.lineId ? true : undefined}
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        <Field label="身分類別" required>
          <select
            value={input.role}
            onChange={(event) => update({ role: event.target.value })}
            aria-invalid={errors.role ? true : undefined}
            className={inputClass}
          >
            {REGISTRANT_ROLES.map((role) => (
              <option key={role} value={role}>
                {REGISTRANT_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="場地與課程">
        <Field label="場地" required>
          <select
            value={input.venueId}
            onChange={(event) => chooseVenue(event.target.value)}
            aria-invalid={errors.venue ? true : undefined}
            className={inputClass}
          >
            <option value="">請選擇</option>
            {options.venues.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        {sessions.map((session) => (
          <Field key={session.id} label={session.name}>
            <select
              value={choices[session.id] ?? ""}
              onChange={(event) => chooseSessionCourse(session.id, event.target.value || null)}
              aria-invalid={errors.courses ? true : undefined}
              className={inputClass}
            >
              <option value="">不選課</option>
              {session.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {label(course)}
                  {course.pairedWith ? "（連續兩堂）" : ""}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </Section>

      <Section title="午餐與服務">
        {venue && venue.lunchOptions.length > 0 && (
          <Field label="午餐">
            <select
              value={input.lunchOptionId ?? ""}
              onChange={(event) => update({ lunchOptionId: event.target.value || null })}
              aria-invalid={errors.lunch ? true : undefined}
              className={inputClass}
            >
              <option value="">不需要</option>
              {venue.lunchOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {label(option)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {venue && venue.afternoonActivities.length > 0 && (
          <Field label="午后動態">
            <select
              value={input.afternoonActivityId ?? ""}
              onChange={(event) => update({ afternoonActivityId: event.target.value || null })}
              aria-invalid={errors.afternoonActivity ? true : undefined}
              className={inputClass}
            >
              <option value="">不參加</option>
              {venue.afternoonActivities.map((option) => (
                <option key={option.id} value={option.id}>
                  {label(option)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="即席唱詩班">
          <select
            value={input.choirPart ?? ""}
            onChange={(event) => update({ choirPart: event.target.value || null })}
            className={inputClass}
          >
            <option value="">不參加</option>
            {CHOIR_PARTS.map((part) => (
              <option key={part} value={part}>
                {zh.choirParts[part]}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">其他服務意願</legend>
          {SERVICES.map((service) => (
            <label key={service} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={input.services.includes(service)}
                onChange={(event) =>
                  update({
                    services: event.target.checked
                      ? [...input.services, service]
                      : input.services.filter((item) => item !== service),
                  })
                }
                className="size-5"
              />
              {zh.serviceNames[service]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2" aria-invalid={errors.printedHandbook ? true : undefined}>
          <legend className="mb-1 font-semibold">
            紙本手冊<span className="text-destructive">＊</span>
          </legend>
          {[
            [true, "需要"],
            [false, "不需要"],
          ].map(([value, text]) => (
            <label key={String(value)} className="flex items-center gap-2">
              <input
                type="radio"
                name="printedHandbook"
                checked={input.printedHandbook === value}
                onChange={() => update({ printedHandbook: value as boolean })}
                className="size-5"
              />
              {text}
            </label>
          ))}
        </fieldset>
      </Section>

      {!registration && (
        <label className="flex items-center gap-2 font-semibold">
          <input
            type="checkbox"
            checked={input.portraitConsent}
            onChange={(event) => update({ portraitConsent: event.target.checked })}
            aria-invalid={errors.portraitConsent ? true : undefined}
            className="size-5"
          />
          報名者已同意肖像權<span className="text-destructive">＊</span>
        </label>
      )}

      <button
        disabled={pending}
        aria-busy={pending}
        className={cn(buttonVariants(), buttonClass, "inline-flex items-center gap-2 self-start font-bold disabled:cursor-wait")}
      >
        {pending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
        {pending ? "處理中…" : registration ? "儲存修改" : "新增報名"}
      </button>

      <dialog
        ref={dialog}
        role="alertdialog"
        aria-labelledby="full-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border-2 border-destructive bg-background p-6 text-foreground backdrop:bg-black/50"
      >
        <h2 id="full-dialog-title" className="text-xl font-bold text-destructive">
          已額滿
        </h2>
        <ul className="mt-3 list-disc pl-6 text-lg">
          {(fullOptions?.length ? fullOptions : ["所選的選項"]).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-lg">已經額滿，確定要加入嗎？加入後會超過名額。</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className={cn(buttonVariants({ variant: "outline" }), buttonClass)}
          >
            取消
          </button>
          <button type="button" onClick={confirmFull} className={cn(buttonVariants(), buttonClass, "font-bold")}>
            確定加入
          </button>
        </div>
      </dialog>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border-2 border-card-outline p-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
