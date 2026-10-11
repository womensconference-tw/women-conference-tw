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
