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
    "home.conferenceDate": [2099, "SAMPLE_DATE"],
    "home.registrationOpensAt": ["SAMPLE_DATE_TIME"],
    "home.registrationOpenUntil": ["SAMPLE_DATE_TIME"],
    "home.conferenceTime": ["SAMPLE_START", "SAMPLE_END"],
    "home.conferenceStartsAt": ["SAMPLE_START"],
    "home.simultaneous": ["SAMPLE_PLACES"],
    "home.helpLineId": ["SAMPLE_LINE_ID"],
    "register.choirWithPart": ["SAMPLE_PART"],
    "register.pairedWith": ["SAMPLE_SESSION", "SAMPLE_COURSE"],
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
