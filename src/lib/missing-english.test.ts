import { describe, expect, it } from "vitest";
import { missingEnglish } from "./missing-english";

describe("英文缺漏警示", () => {
  it("中文有填、英文空白時要警示", () => {
    expect(missingEnglish("歡迎", "")).toBe(true);
    expect(missingEnglish("歡迎", "  ")).toBe(true);
    expect(missingEnglish("歡迎", "Welcome")).toBe(false);
    // 中文也沒填，前台不會顯示，不必警示。
    expect(missingEnglish("", "")).toBe(false);
  });
});
