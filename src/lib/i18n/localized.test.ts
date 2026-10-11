import { describe, expect, it } from "vitest";
import { localized } from "./localized";

const venue = { name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" };

describe("資料庫中英欄位", () => {
  it("中文版顯示中文", () => {
    expect(localized(venue, "name", "zh")).toBe("台北金華教堂");
  });

  it("英文版顯示英文", () => {
    expect(localized(venue, "name", "en")).toBe("Taipei Jinhua Chapel");
  });

  // 後台英文還沒填時，英文版不留空白。
  it.each([
    { missing: "沒填（null）", name_en: null },
    { missing: "空字串", name_en: "" },
    { missing: "只有空白", name_en: "  \n" },
  ])("英文$missing時，英文版顯示中文", ({ name_en }) => {
    expect(localized({ name_zh: "台北金華教堂", name_en }, "name", "en")).toBe("台北金華教堂");
  });
});
