import type { Metadata } from "next";
import { LanguageSwitch } from "@/components/language-switch";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentConference } from "@/lib/conference";
import { getHomeContent } from "@/lib/home-content";
import { getRegistrationOptions } from "@/lib/registration-options";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { LookupForm } from "./lookup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages();
  return { title: t.lookup.title };
}

/**
 * 查詢頁：用姓名＋電話（或報名編號）查自己的報名。任何時候都能查；報名中可以接著修改。
 * 已截止時先說明現在只能查詢，修改與取消要聯絡管理員，並列出管理員 LINE。
 * 場地、課程、午餐的名稱用報名表的選項顯示，所以這裡一起讀進來。
 */
export default async function LookupPage() {
  const locale = await getLocale();
  const t = await getMessages();
  const supabase = await createClient();
  const [conference, options] = await Promise.all([
    getCurrentConference(supabase, new Date()),
    getRegistrationOptions(supabase, locale),
  ]);
  // 管理員 LINE 只在已截止時顯示。
  const adminLine =
    conference?.phase === "closed" ? ((await getHomeContent(supabase, locale))?.adminLine ?? null) : null;

  return (
    <main className="mx-auto flex w-full max-w-(--content-max-width) flex-1 flex-col gap-8 px-5 pt-3 pb-8 text-body leading-relaxed">
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      {/* 查到的支聯會、支會名稱是依當時的語言挑好的；換語言時重新開始，不留下另一種語言的名稱。 */}
      <LookupForm
        key={locale}
        locale={locale}
        options={options}
        canEdit={conference?.phase === "open"}
        notice={
          conference?.phase === "closed" && (
            <section className="flex flex-col gap-3 rounded-lg border-2 border-card-outline p-5">
              <h2 className="text-lead font-bold">{t.lookup.closedHeading}</h2>
              <p>{t.lookup.closedDescription}</p>
              {adminLine ? (
                <>
                  <p className="font-semibold">{t.home.helpLineId(adminLine.id)}</p>
                  <a
                    href={adminLine.url}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-auto min-h-(--button-min-height) px-6 py-3 text-(length:--text-body-size) whitespace-normal text-center",
                    )}
                  >
                    {t.home.helpLineButton}
                  </a>
                </>
              ) : (
                <p>{t.home.helpLineComingSoon}</p>
              )}
            </section>
          )
        }
      />
    </main>
  );
}
