"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { RegistrationDetails } from "@/components/registration-details";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locale";
import { messages, type Messages } from "@/lib/i18n/messages";
import type {
  CancelError,
  FoundRegistration,
  LookupErrors,
  LookupField,
  LookupInput,
  Registration,
} from "@/lib/registration";
import type { RegistrationOptions } from "@/lib/registration-options";
import { cn } from "@/lib/utils";
import { RegistrationForm } from "../register/registration-form";
import { cancelMine, lookUp } from "./actions";

// 與報名表同一套大按鈕、大輸入框。經過 cn() 的字級要寫成 text-(length:…)，見首頁的說明。
const actionClass =
  "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal text-center";
const textInputClass =
  "min-h-(--button-min-height) w-full rounded-lg border-2 border-input bg-background px-4 py-2 aria-invalid:border-destructive";

/**
 * 查詢表單：姓名，以及電話或報名編號（同一格，系統依長度分辨）。
 * 查到後在表單下方顯示報名資料；查不到時只說找不到，不說是哪一項不對。
 * 報名中（canEdit）時，未取消的報名可以按「修改這筆報名」，在同一頁換成報名表的修改模式；
 * 修改時用這筆報名存下的姓名與電話（或報名編號）再比對一次。改好或不改了，回到查詢結果。
 * 也可以按「取消這筆報名」：在同一張卡片裡先確認（不用彈出視窗），確定後標成已取消。
 */
export function LookupForm({
  locale,
  options,
  canEdit,
  notice,
}: {
  locale: Locale;
  options: RegistrationOptions;
  canEdit: boolean;
  /** 標題下方的說明，例如已截止時只能查詢。 */
  notice?: ReactNode;
}) {
  const t = messages[locale];
  const [input, setInput] = useState<LookupInput>({ name: "", phoneOrNumber: "" });
  const [errors, setErrors] = useState<LookupErrors>({});
  const [found, setFound] = useState<FoundRegistration[]>([]);
  const [pending, startTransition] = useTransition();
  const resultRef = useRef<HTMLElement>(null);
  // 輸入改過幾次。查詢期間有人改了輸入，晚回來的結果就是上一位的，不顯示。
  const edits = useRef(0);
  // 正在修改的那一筆。
  const [editing, setEditing] = useState<FoundRegistration | null>(null);
  // 正在確認取消的那一筆，以及取消的結果。
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<CancelError | null>(null);
  const [cancelledId, setCancelledId] = useState<string | null>(null);
  const [cancelPending, startCancel] = useTransition();

  // 改了哪一格就收起那一格的錯誤；「找不到」也一起收起，免得她改好了還看到舊訊息。
  // 查到的資料也收起：家人輪流用同一支手機查時，下一位不會看到上一位的個資。
  function update(field: keyof LookupInput, value: string) {
    edits.current += 1;
    setInput((prev) => ({ ...prev, [field]: value }));
    setFound([]);
    setCancelling(null);
    setCancelledId(null);
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
        setCancelling(null);
        setCancelledId(null);
        setFound(result.registrations);
        // 查到後把報名資料捲到畫面上，手機上不必自己往下找。
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "start" }));
      } else {
        setFound([]);
        setErrors(result.errors);
      }
    });
  }

  // 改好了：查詢結果換成修改後的資料（改了電話的話，之後再修改就用新的電話比對）。
  function closeEdit(updated?: Registration) {
    setEditing(null);
    if (updated) {
      setFound((prev) =>
        prev.map((registration) =>
          registration.id === updated.id ? { ...registration, ...updated } : registration,
        ),
      );
    }
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "start" }));
  }

  function openCancel(id: string) {
    setCancelling(id);
    setCancelError(null);
  }

  // 和修改一樣，用這筆報名存下的姓名與電話（或報名編號）再比對一次。
  function confirmCancel(registration: FoundRegistration) {
    if (cancelPending) return;
    const editsAtSubmit = edits.current;
    startCancel(async () => {
      let result;
      try {
        result = await cancelMine({
          registrationId: registration.id,
          lookup: {
            name: registration.name,
            phoneOrNumber: registration.phone ?? registration.registrationNumber ?? "",
          },
        });
      } catch {
        result = { ok: false, error: "unknown" } as const;
      }
      // 送出期間她改了查詢的姓名或電話，查詢結果已經收起，不再顯示。
      if (edits.current !== editsAtSubmit) return;
      if (result.ok) {
        setFound((prev) =>
          prev.map((item) => (item.id === registration.id ? { ...item, status: "cancelled" } : item)),
        );
        setCancelling(null);
        setCancelledId(registration.id);
        // 確認區塊消失了，把焦點移到「已經取消」那句，用鍵盤或螢幕閱讀器的人才知道結果。
        requestAnimationFrame(() => document.getElementById(`cancelled-${registration.id}`)?.focus());
      } else {
        setCancelError(result.error);
      }
    });
  }

  if (editing) {
    return (
      <RegistrationForm
        locale={locale}
        options={options}
        edit={{
          registration: editing,
          // 查到她時姓名與電話（或報名編號）就和存下的相符，修改時用存下的再比對一次。
          lookup: {
            name: editing.name,
            phoneOrNumber: editing.phone ?? editing.registrationNumber ?? "",
          },
          onClose: closeEdit,
        }}
      />
    );
  }

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-title leading-tight font-bold">{t.lookup.title}</h1>
        <p>{t.lookup.description}</p>
      </header>
      {notice}
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
                <p
                  id={`cancelled-${registration.id}`}
                  tabIndex={-1}
                  className="font-semibold text-destructive outline-none"
                >
                  {cancelledId === registration.id ? t.cancel.done : t.lookup.cancelled}
                </p>
              )}
              <RegistrationDetails
                registration={registration}
                registrationNumber={registration.registrationNumber}
                options={options}
                t={t}
              />
              {canEdit && registration.status === "registered" &&
                (cancelling === registration.id ? (
                  <CancelConfirm
                    pending={cancelPending}
                    error={cancelError}
                    onConfirm={() => confirmCancel(registration)}
                    onKeep={() => setCancelling(null)}
                    t={t}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(registration);
                        window.scrollTo({ top: 0 });
                      }}
                      // 別筆正在取消時先不能修改，取消的結果才看得到。
                      disabled={cancelPending}
                      className={cn(buttonVariants(), actionClass, "font-bold")}
                    >
                      {t.lookup.editButton}
                    </button>
                    <button
                      type="button"
                      onClick={() => openCancel(registration.id)}
                      disabled={cancelPending}
                      className={cn(buttonVariants({ variant: "outline" }), actionClass)}
                    >
                      {t.cancel.button}
                    </button>
                  </>
                ))}
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

/** 取消前的確認：說明取消後名額會讓出、不能恢復，再按一次才送出。 */
function CancelConfirm({
  pending,
  error,
  onConfirm,
  onKeep,
  t,
}: {
  pending: boolean;
  error: CancelError | null;
  onConfirm: () => void;
  onKeep: () => void;
  t: Messages;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 打開確認時把焦點移到標題，用螢幕閱讀器的人才知道畫面換了。
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section
      aria-labelledby="cancel-confirm-heading"
      className="flex flex-col gap-3 rounded-lg border-2 border-destructive p-4"
    >
      <h3
        id="cancel-confirm-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-lead font-bold outline-none"
      >
        {t.cancel.confirmHeading}
      </h3>
      <p>{t.cancel.confirmDescription}</p>
      {error && (
        <p role="alert" className="font-semibold text-destructive">
          {t.cancel.errors[error]}
        </p>
      )}
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className={cn(buttonVariants(), actionClass, "bg-destructive font-bold text-white hover:bg-destructive/80")}
      >
        {pending ? t.cancel.confirmingButton : t.cancel.confirmButton}
      </button>
      <button
        type="button"
        onClick={onKeep}
        disabled={pending}
        className={cn(buttonVariants({ variant: "outline" }), actionClass)}
      >
        {t.cancel.keepButton}
      </button>
    </section>
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
