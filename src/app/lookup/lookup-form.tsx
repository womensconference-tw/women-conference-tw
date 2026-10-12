"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { RegistrationDetails } from "@/components/registration-details";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import { messages, type Messages } from "@/lib/i18n/messages";
import type {
  FoundRegistration,
  LookupErrors,
  LookupField,
  LookupInput,
} from "@/lib/registration";
import type { RegistrationOptions } from "@/lib/registration-options";
import { cn } from "@/lib/utils";
import { lookUp } from "./actions";

// 與報名表同一套大按鈕、大輸入框。經過 cn() 的字級要寫成 text-(length:…)，見首頁的說明。
const actionClass =
  "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal text-center";
const textInputClass =
  "min-h-(--button-min-height) w-full rounded-lg border-2 border-input bg-background px-4 py-2 aria-invalid:border-destructive";

/**
 * 查詢表單：姓名，以及電話或報名編號（同一格，系統依長度分辨）。
 * 查到後在表單下方顯示報名資料；查不到時只說找不到，不說是哪一項不對。
 */
export function LookupForm({ locale, options }: { locale: Locale; options: RegistrationOptions }) {
  const t = messages[locale];
  const [input, setInput] = useState<LookupInput>({ name: "", phoneOrNumber: "" });
  const [errors, setErrors] = useState<LookupErrors>({});
  const [found, setFound] = useState<FoundRegistration[]>([]);
  const [pending, startTransition] = useTransition();
  const resultRef = useRef<HTMLElement>(null);
  // 輸入改過幾次。查詢期間有人改了輸入，晚回來的結果就是上一位的，不顯示。
  const edits = useRef(0);

  // 改了哪一格就收起那一格的錯誤；「找不到」也一起收起，免得她改好了還看到舊訊息。
  // 查到的資料也收起：家人輪流用同一支手機查時，下一位不會看到上一位的個資。
  function update(field: keyof LookupInput, value: string) {
    edits.current += 1;
    setInput((prev) => ({ ...prev, [field]: value }));
    setFound([]);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      delete next.form;
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const editsAtSubmit = edits.current;
    startTransition(async () => {
      let result;
      try {
        result = await lookUp(input);
      } catch {
        if (edits.current !== editsAtSubmit) return;
        setFound([]);
        setErrors({ form: "unknown" });
        return;
      }
      if (edits.current !== editsAtSubmit) return;
      if (result.ok) {
        setErrors({});
        setFound(result.registrations);
        // 查到後把報名資料捲到畫面上，手機上不必自己往下找。
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "start" }));
      } else {
        setFound([]);
        setErrors(result.errors);
      }
    });
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        <TextField
          field="name"
          label={t.lookup.nameLabel}
          value={input.name}
          onChange={(value) => update("name", value)}
          autoComplete="name"
          errors={errors}
          t={t}
        />
        <TextField
          field="phoneOrNumber"
          label={t.lookup.phoneOrNumberLabel}
          hint={t.lookup.phoneOrNumberHint}
          value={input.phoneOrNumber}
          onChange={(value) => update("phoneOrNumber", value)}
          type="tel"
          autoComplete="tel"
          errors={errors}
          t={t}
        />
        {errors.form && (
          <p role="alert" className="rounded-lg border-2 border-destructive p-4 font-semibold text-destructive">
            {t.lookup.errors[errors.form]}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants(), actionClass, "font-bold")}
        >
          {pending ? t.lookup.submittingButton : t.lookup.submitButton}
        </button>
      </form>

      {found.length > 0 && (
        <section ref={resultRef} aria-live="polite" className="flex scroll-mt-3 flex-col gap-4">
          {found.map((registration) => (
            <div
              key={registration.id}
              className="flex flex-col gap-3 rounded-lg border-4 border-primary px-4 py-3"
            >
              <h2 className="text-heading leading-tight font-bold">{t.lookup.resultHeading}</h2>
              {registration.status === "cancelled" && (
                <p className="font-semibold text-destructive">{t.lookup.cancelled}</p>
              )}
              <RegistrationDetails
                registration={registration}
                registrationNumber={registration.registrationNumber}
                options={options}
                t={t}
              />
            </div>
          ))}
        </section>
      )}

      <Link href="/" className={cn(buttonVariants({ variant: "outline" }), actionClass)}>
        {t.register.homeButton}
      </Link>
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
  autoComplete,
  errors,
  t,
}: {
  field: LookupField;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "tel";
  autoComplete?: string;
  errors: LookupErrors;
  t: Messages;
}) {
  const error = errors[field];
  const describedBy = [hint && `${field}-hint`, error && `${field}-error`].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={field} className="text-lead font-bold">
        {label}
      </label>
      {hint && <p id={`${field}-hint`}>{hint}</p>}
      {error && (
        <p id={`${field}-error`} className="font-semibold text-destructive">
          {t.lookup.errors[error]}
        </p>
      )}
      <input
        id={field}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={textInputClass}
      />
    </div>
  );
}
