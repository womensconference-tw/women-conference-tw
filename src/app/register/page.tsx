import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSwitch } from "@/components/language-switch";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference } from "@/lib/conference";
import { getRegistrationOptions } from "@/lib/registration-options";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { RegistrationForm } from "./registration-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages();
  return { title: t.register.title };
}

/**
 * 報名頁。只有報名中才顯示表單；送出時資料庫會再確認一次是否報名中。
 * 從首頁「幫家人或朋友報名」進來（?for=others）時，表單第一步多一句代報的說明。
 */
export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const forOthers = (await searchParams).for === "others";
  const [conference, allOptions] = await Promise.all([
    getCurrentConference(supabase, new Date()),
    getRegistrationOptions(supabase, locale),
  ]);
  // 還沒設定場地或支聯會時，表單填到一半會卡住，所以也當成還不能報名。
  const options =
    conference?.phase === "open" && allOptions.venues.length > 0 && allOptions.stakes.length > 0
      ? allOptions
      : null;

  return (
    <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-8 px-5 pt-3 pb-8 text-body leading-relaxed">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      {options ? (
        <RegistrationForm locale={locale} options={options} forOthers={forOthers} />
      ) : (
        <section className="flex flex-col gap-4">
          <h1 className="text-title leading-tight font-bold">{t.register.notOpenHeading}</h1>
          <p>{t.register.notOpenDescription}</p>
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal",
            )}
          >
            {t.register.homeButton}
          </Link>
        </section>
      )}
    </main>
  );
}
