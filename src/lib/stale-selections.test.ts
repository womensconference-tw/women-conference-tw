import { describe, expect, it } from "vitest";
import type { PairedCourse, RegistrationInput } from "./registration";
import type { CourseOption, LimitedOption, RegistrationOptions } from "./registration-options";
import { staleSelections } from "./stale-selections";

// 送出失敗或修改後重新讀取選項時，報名表要清掉哪些選擇。
describe("重新讀取選項後的選擇", () => {
  const option = (id: string, isFull = false): LimitedOption => ({ id, name: id, description: "", isFull });
  const course = (id: string, isFull = false, pairedWith: PairedCourse | null = null): CourseOption => ({
    ...option(id, isFull),
    pairedWith,
  });
  const options: RegistrationOptions = {
    stakes: [],
    venues: [
      {
        id: "venue",
        name: "台北金華教堂",
        sessions: [{ id: "s1", name: "第一場", courses: [course("full-course", true), course("open-course")] }],
        lunchOptions: [option("full-lunch", true), option("open-lunch")],
      },
    ],
  };
  const input = { stakeId: "stake", wardId: "ward", venueId: "venue" } as RegistrationInput;
  const choices = { s1: "full-course" };
  const extras = { lunch: "full-lunch", printedHandbook: true };

  it("報名時剛額滿的課程、午餐取消選取並標出", () => {
    const stale = staleSelections({ ...input, stakeId: "", wardId: "" }, choices, extras, options, [], false);

    expect(stale.choices).toEqual({});
    expect(stale.extras).toEqual({ printedHandbook: true });
    expect(stale.errors).toEqual({ courses: "courseFull", lunch: "lunchFull" });
  });

  it("修改時她原本已佔的額滿選項照樣保留，新選的額滿選項取消選取", () => {
    const stale = staleSelections(input, choices, extras, options, ["full-course"], true);

    expect(stale.choices).toEqual({ s1: "full-course" });
    expect(stale.extras).toEqual({ printedHandbook: true });
    expect(stale.errors).toEqual({ lunch: "lunchFull" });
  });

  it("成對課程其中一堂取消選取時，另一堂也取消，兩個場次都要重選", () => {
    const paired: RegistrationOptions = {
      stakes: [],
      venues: [
        {
          ...options.venues[0],
          sessions: [
            { id: "s1", name: "第一場", courses: [course("upper", false, { sessionId: "s2", courseId: "lower" })] },
            { id: "s2", name: "第二場", courses: [course("lower", true, { sessionId: "s1", courseId: "upper" })] },
            { id: "s3", name: "第三場", courses: [course("other")] },
          ],
        },
      ],
    };

    const stale = staleSelections(
      { ...input, stakeId: "", wardId: "" },
      { s1: "upper", s2: "lower", s3: "other" },
      {},
      paired,
      [],
      false,
    );

    expect(stale.choices).toEqual({ s3: "other" });
    expect(stale.errors).toMatchObject({ courses: "courseFull" });
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
