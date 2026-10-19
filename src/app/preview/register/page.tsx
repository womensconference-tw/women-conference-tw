import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LanguageSwitch } from "@/components/language-switch";
import { getRegistrationOptions, hasRegistrationChoices } from "@/lib/registration-options";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { RegistrationForm } from "../../register/registration-form";
import { getCurrentStaff } from "../../staff/current-staff";
import { PreviewBanner } from "../preview-banner";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages();
  return { title: t.register.title };
}

/**
 * 後台的預覽報名表：照前台報名表的樣子，不管報名開放沒有都能一步步點到確認頁，但不能送出。
 * proxy 已經擋下沒登入的人；這裡再確認是工作人員。
 */
export default async function PreviewRegisterPage({ searchParams }: PageProps<"/preview/register">) {
  if (!(await getCurrentStaff())) redirect("/staff/login");
  const locale = await getLocale();
  const t = await getMessages();
  const forOthers = (await searchParams).for === "others";
  const options = await getRegistrationOptions(await createClient(), locale);

  return (
    <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-8 px-5 pt-3 pb-8 text-body leading-relaxed">
      <PreviewBanner>{t.preview.register}</PreviewBanner>
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      {hasRegistrationChoices(options) ? (
        <RegistrationForm locale={locale} options={options} forOthers={forOthers} preview />
      ) : (
        <p>{t.preview.registerNoOptions}</p>
      )}
    </main>
  );
}
