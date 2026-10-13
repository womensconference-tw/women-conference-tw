import { describe, expect, it } from "vitest";
import type { RegistrationInput } from "./registration";
import type { LimitedOption, RegistrationOptions } from "./registration-options";
import { staleSelections } from "./stale-selections";

// 送出失敗或修改後重新讀取選項時，報名表要清掉哪些選擇。
describe("重新讀取選項後的選擇", () => {
  const option = (id: string, isFull = false): LimitedOption => ({ id, name: id, description: "", isFull });
  const options: RegistrationOptions = {
    stakes: [],
    venues: [
      {
        id: "venue",
        name: "台北金華教堂",
        sessions: [{ id: "s1", name: "第一場", courses: [option("full-course", true), option("open-course")] }],
        lunchOptions: [option("full-lunch", true), option("open-lunch")],
        afternoonActivities: [option("full-activity", true)],
      },
    ],
  };
  const input = { stakeId: "stake", wardId: "ward", venueId: "venue" } as RegistrationInput;
  const choices = { s1: "full-course" };
  const extras = { lunch: "full-lunch", afternoonActivity: "full-activity", printedHandbook: true };

  it("報名時剛額滿的課程、午餐、午后動態取消選取並標出", () => {
    const stale = staleSelections({ ...input, stakeId: "", wardId: "" }, choices, extras, options, [], false);

    expect(stale.choices).toEqual({});
    expect(stale.extras).toEqual({ printedHandbook: true });
    expect(stale.errors).toEqual({
      courses: "courseFull",
      lunch: "lunchFull",
      afternoonActivity: "afternoonActivityFull",
    });
  });

  it("修改時她原本已佔的額滿選項照樣保留，新選的額滿選項取消選取", () => {
    const stale = staleSelections(
      input,
      choices,
      extras,
      options,
      ["full-course", "full-activity"],
      true,
    );

    expect(stale.choices).toEqual({ s1: "full-course" });
    expect(stale.extras).toEqual({ afternoonActivity: "full-activity", printedHandbook: true });
    expect(stale.errors).toEqual({ lunch: "lunchFull" });
  });

  // 支聯會、支會在修改時不能改；報名後停用了，也照樣是她報名當下的那一個。
  it("修改時不因支聯會、支會已不在名單裡而清掉", () => {
    const stale = staleSelections(input, {}, {}, options, [], true);

    expect(stale.changes).toEqual({});
    expect(stale.errors).toEqual({});
  });

  it("報名時支聯會已不在名單裡，清掉支聯會與支會", () => {
    const stale = staleSelections(input, {}, {}, options, [], false);

    expect(stale.changes).toEqual({ stakeId: "", wardId: "" });
    expect(stale.errors).toEqual({ stake: "stakeUnavailable" });
  });
});
