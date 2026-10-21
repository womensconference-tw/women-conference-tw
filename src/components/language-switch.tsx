import { EnhancedInput } from "@/components/enhanced-input";
import { LanguageSwitchButton } from "@/components/language-switch-button";
import { switchLanguage } from "@/lib/i18n/actions";
import { languageTags, type Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { getLocale } from "@/lib/i18n/server";

// 只有兩種語言，所以用一顆按鈕直接切到另一種，不用下拉選單或彈出視窗。
const otherLocale: Record<Locale, Locale> = { zh: "en", en: "zh" };

export async function LanguageSwitch() {
  const locale = await getLocale();
  const target = otherLocale[locale];

  return (
    <form action={switchLanguage}>
      <input type="hidden" name="locale" value={target} />
      <EnhancedInput />
      <LanguageSwitchButton lang={languageTags[target]}>{messages[locale].languageSwitch}</LanguageSwitchButton>
    </form>
  );
}
