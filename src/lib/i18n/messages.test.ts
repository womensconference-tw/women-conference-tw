import { describe, expect, it } from "vitest";
import { locales } from "./locale";
import { messages } from "./messages";

// 型別檢查已經會擋住缺漏的鍵；這裡再擋住型別擋不到的空字串，並在測試報告裡列出缺哪個鍵。
describe("介面文字對照檔", () => {
  it("每種語言都有相同的鍵", () => {
    const [first, ...rest] = locales;
    for (const locale of rest) {
      expect(keyPaths(messages[locale]), `${locale} 與 ${first} 的鍵不同`).toEqual(
        keyPaths(messages[first]),
      );
    }
  });

  it.each(locales)("%s 沒有空白的文字", (locale) => {
    const blank = leaves(messages[locale])
      .filter(([, value]) => typeof value === "string" && value.trim() === "")
      .map(([path]) => path);

    expect(blank).toEqual([]);
  });

  // 要帶入資料的文字，每一則都要在這裡列出測試用的資料。
  const sampleArgs: Record<string, unknown[]> = {
    "email.greeting": ["SAMPLE_NAME"],
    "landing.title": [2099],
    "landing.opensOn": ["SAMPLE_DATE_TIME"],
    "landing.closesOn": ["SAMPLE_DATE_TIME"],
    "landing.canChangeUntil": ["SAMPLE_DATE"],
    "landing.conferenceTime": ["SAMPLE_START", "SAMPLE_END"],
    "landing.conferenceStartsAt": ["SAMPLE_START"],
    "register.choirWithPart": ["SAMPLE_PART"],
    "register.pairedWith": ["SAMPLE_SESSION", "SAMPLE_COURSE"],
    "register.speaker": ["SAMPLE_SPEAKER"],
    "register.stepProgress": [2, 3, "SAMPLE_STEP"],
    "register.wardsOf": ["SAMPLE_STAKE"],
    "register.wardWithStake": ["SAMPLE_WARD", "SAMPLE_STAKE"],
  };

  it.each(locales)("%s 帶入資料的文字不空白，且有放進帶入的資料", (locale) => {
    const templates = leaves(messages[locale]).filter(
      (entry): entry is [string, (...args: unknown[]) => string] => typeof entry[1] === "function",
    );

    expect(templates.map(([path]) => path).sort()).toEqual(Object.keys(sampleArgs).sort());
    for (const [path, template] of templates) {
      const args = sampleArgs[path];
      const text = template(...args);
      expect(text.trim(), path).not.toBe("");
      for (const arg of args) expect(text, path).toContain(String(arg));
    }
  });
});

// 不提供大會管理員的聯絡方式（#126 拿掉）：前台文字請姐妹問自己支會或分會的慈助會會長。
describe("求助指引", () => {
  const guidanceKeys = [
    "landing.closedDescription",
    "register.errors.portraitConsentRequired",
    "lookup.closedDescription",
    "lookup.errors.notFound",
    "email.footer",
  ];
  const guidance = {
    zh: "如有疑問，請聯絡您所屬支會或分會的慈助會會長。",
    en: "If you have questions, please contact your ward or branch Relief Society president.",
  };

  it.each(locales)("%s 不叫人聯絡大會管理員", (locale) => {
    const mentions = leaves(messages[locale])
      .filter(([, value]) => typeof value === "string")
      .filter(([, value]) => /管理員|administrator/i.test(value as string))
      .map(([path]) => path);

    expect(mentions).toEqual([]);
  });

  it.each(locales)("%s 需要求助的地方請姐妹聯絡慈助會會長", (locale) => {
    const text = Object.fromEntries(leaves(messages[locale]));
    for (const key of guidanceKeys) expect(text[key], key).toContain(guidance[locale]);
  });
});

function leaves(node: object, prefix = ""): [string, unknown][] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object"
      ? leaves(value, path)
      : [[path, value] as [string, unknown]];
  });
}

function keyPaths(node: object): string[] {
  return leaves(node)
    .map(([path]) => path)
    .sort();
}
