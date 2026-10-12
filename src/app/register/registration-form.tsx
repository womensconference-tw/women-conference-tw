"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import { messages, type Messages } from "@/lib/i18n/messages";
import {
  validateRegistration,
  type Registration,
  type RegistrationErrors,
  type RegistrationField,
  type RegistrationInput,
} from "@/lib/registration";
import { searchWards, type RegistrationOptions } from "@/lib/registration-options";
import { cn } from "@/lib/utils";
import { register } from "./actions";

// 每一步有哪些欄位：按「下一步」時只檢查這一步，送出失敗時跳回第一個有錯的那一步。
const stepFields: RegistrationField[][] = [
  ["name", "phone", "email", "lineId", "stake", "ward"],
  ["venue"],
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
  venueId: ["venue"],
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
  portraitConsent: false,
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
 * 報名表：基本資料 → 選場地 → 肖像權同意與確認 → 完成頁。
 * 三步都在同一頁切換，回上一步不會清掉已填的資料；送出後在同一頁顯示完成頁。
 * 不用下拉選單：支聯會、支會、場地都是攤開的大選項。
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
  const [pending, startTransition] = useTransition();

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

  function showErrors(next: RegistrationErrors) {
    setErrors(next);
    const first = stepFields.flat().find((field) => next[field]);
    if (!first) return;
    setStep(stepFields.findIndex((fields) => fields.includes(first)));
    // 等畫面換到有錯的那一步，再把游標移到第一個有錯的欄位。
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-field="${first}"][tabindex], [data-field="${first}"] :is(input, button, [tabindex])`,
        )
        ?.focus();
    });
  }

  function goTo(nextStep: number) {
    setStep(nextStep);
    window.scrollTo({ top: 0 });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const stepErrors = pick(validateRegistration(input), stepFields[step]);
    if (Object.keys(stepErrors).length > 0) {
      showErrors(stepErrors);
      return;
    }
    setErrors({});
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
        window.scrollTo({ top: 0 });
      } else {
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
                onChange={() => update({ venueId: venue.id })}
                {...errorAria("venue", errors, "venue-hint")}
              />
              {venue.name}
            </label>
          ))}
        </fieldset>
      )}

      {step === 2 && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-bold">{t.register.reviewHeading}</h2>
            <RegistrationDetails registration={input} options={options} t={t} />
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

type Details = Pick<RegistrationInput, "name" | "stakeId" | "wardId" | "venueId"> & {
  phone: string | null;
  email: string | null;
  lineId: string | null;
  noPhone?: boolean;
};

/** 報名資料的清單，確認步驟與完成頁共用。 */
function RegistrationDetails({
  registration,
  options,
  t,
}: {
  registration: Details;
  options: RegistrationOptions;
  t: Messages;
}) {
  const stake = options.stakes.find((option) => option.id === registration.stakeId);
  const ward = stake?.wards.find((option) => option.id === registration.wardId);
  const venue = options.venues.find((option) => option.id === registration.venueId);
  const rows: [string, string][] = [
    [t.register.nameLabel, registration.name.trim()],
    [
      t.register.phoneLabel,
      registration.noPhone || !registration.phone ? t.register.noPhone : registration.phone,
    ],
    [t.register.emailLabel, registration.email?.trim() || t.register.notProvided],
    [t.register.lineIdLabel, registration.lineId?.trim() || t.register.notProvided],
    [t.register.stakeLabel, stake?.name ?? ""],
    [t.register.wardLabel, ward?.name ?? ""],
    [t.register.venueLabel, venue?.name ?? ""],
  ];
  return (
    <dl className="flex flex-col gap-3 rounded-lg border-2 border-card-outline p-5">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="font-semibold">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
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
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-title leading-tight font-bold">{t.register.done.heading}</h1>
      {registration.registrationNumber && (
        <div className="flex flex-col gap-2 rounded-lg border-4 border-primary p-5">
          <p className="font-semibold">{t.register.done.registrationNumberLabel}</p>
          <p className="text-title font-bold tracking-widest">{registration.registrationNumber}</p>
          <p>{t.register.done.registrationNumberHint}</p>
        </div>
      )}
      {!registration.email && (
        <p className="rounded-lg bg-muted p-4 font-semibold">{t.register.done.screenshotHint}</p>
      )}
      <p>{t.register.done.description}</p>
      <RegistrationDetails registration={registration} options={options} t={t} />
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }), actionClass)}>
        {t.register.homeButton}
      </Link>
    </section>
  );
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
