// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundRegistration, RegistrationInput, SubmitResult } from "@/lib/registration";
import type { RegistrationOptions } from "@/lib/registration-options";
import { RegistrationForm, type EditTarget } from "./registration-form";

// 伺服器動作換成假的：這裡只測畫面上的操作，送出後的規則由報名服務的測試負責。
const register = vi.fn<(input: unknown, submissionKey: unknown) => Promise<SubmitResult>>();
const updateMine = vi.fn<(input: unknown) => Promise<SubmitResult>>();
vi.mock("./actions", () => ({
  register: (input: unknown, submissionKey: unknown) => register(input, submissionKey),
}));
vi.mock("../lookup/actions", () => ({
  updateMine: (input: unknown) => updateMine(input),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JINHUA = id(1);
const TAICHUNG = id(2);
const MORNING = id(11);
const AFTERNOON = id(12);
const TAICHUNG_MORNING = id(13);
const QUILTING = id(21);
const FLOWERS = id(22);
const SINGING = id(23);
const CALLIGRAPHY = id(24);
const BENTO = id(31);
const VEGETARIAN = id(32);
const NOODLES = id(33);
const HIKING = id(41);
const CHOIR = id(42);
const STAKE = id(51);
const WARD = id(52);

const course = (courseId: string, name: string) => ({
  id: courseId,
  name,
  description: "",
  isFull: false,
  pairedWith: null,
});
const limited = (optionId: string, name: string) => ({ id: optionId, name, description: "", isFull: false });

// 兩個場地：金華教堂有上午、下午兩個場次，台中教堂只有一個場次。讀取當下都還有名額。
const options: RegistrationOptions = {
  venues: [
    {
      id: JINHUA,
      name: "金華教堂",
      sessions: [
        { id: MORNING, name: "上午", courses: [course(QUILTING, "拼布"), course(FLOWERS, "插花")] },
        { id: AFTERNOON, name: "下午", courses: [course(SINGING, "唱歌")] },
      ],
      lunchOptions: [limited(BENTO, "便當"), limited(VEGETARIAN, "素食便當")],
      afternoonActivities: [limited(HIKING, "健行")],
    },
    {
      id: TAICHUNG,
      name: "台中教堂",
      sessions: [{ id: TAICHUNG_MORNING, name: "台中上午", courses: [course(CALLIGRAPHY, "書法")] }],
      lunchOptions: [limited(NOODLES, "麵食")],
      afternoonActivities: [limited(CHOIR, "合唱練習")],
    },
  ],
  stakes: [
    {
      id: STAKE,
      name: "台北支聯會",
      wards: [{ id: WARD, name: "新店支會", nameZh: "新店支會", nameEn: "Xindian Ward" }],
    },
  ],
};

/** 頁面重新讀取後的選項：ids 裡的課程、午餐、午后動態變成已額滿。每次都是新的物件，跟頁面重新讀取一樣。 */
function withFull(...ids: string[]): RegistrationOptions {
  const mark = <T extends { id: string; isFull: boolean }>(option: T): T =>
    ids.includes(option.id) ? { ...option, isFull: true } : option;
  return {
    ...options,
    venues: options.venues.map((venue) => ({
      ...venue,
      sessions: venue.sessions.map((session) => ({ ...session, courses: session.courses.map(mark) })),
      lunchOptions: venue.lunchOptions.map(mark),
      afternoonActivities: venue.afternoonActivities.map(mark),
    })),
  };
}

// 她原本在金華教堂上午上拼布、下午不選課，午餐吃便當、參加健行。
const found: FoundRegistration = {
  id: id(91),
  name: "王小美",
  phone: "0912345678",
  registrationNumber: null,
  email: null,
  lineId: null,
  stakeId: STAKE,
  wardId: WARD,
  venueId: JINHUA,
  courseIds: [QUILTING],
  lunchOptionId: BENTO,
  afternoonActivityId: HIKING,
  choirPart: null,
  services: [],
  printedHandbook: false,
  status: "registered",
  stakeName: "台北支聯會",
  wardName: "新店支會",
};

const onClose = vi.fn();
const edit: EditTarget = {
  registration: found,
  lookup: { name: "王小美", phoneOrNumber: "0912345678" },
  onClose,
};

const step = (text: string) => screen.getByText(new RegExp(`^第 \\d 步（共 5 步）：${text}$`));
const group = (name: string) => screen.getByRole("group", { name });
const radio = (groupName: string, name: string | RegExp) =>
  within(group(groupName)).getByRole<HTMLInputElement>("radio", { name });
const button = (name: string) => screen.getByRole("button", { name });

beforeAll(() => {
  // jsdom 沒有實作捲動：換步驟時捲到最上面，完成頁把報名資料捲進畫面。
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  register.mockReset();
  updateMine.mockReset();
  onClose.mockReset();
});

afterEach(cleanup);

describe("修改報名時換場地", () => {
  // 每一步都會先檢查，沒重選的話「改好了，回到確認頁」「下一步」都會停在要重選的那一步，到不了「確認送出修改」。
  it("課程、午餐、午后動態被清空，沒重選就回不到確認頁，也不會送出", async () => {
    const user = userEvent.setup();
    render(<RegistrationForm locale="zh" options={options} edit={edit} />);
    const noneChecked = (name: string) =>
      within(group(name))
        .getAllByRole<HTMLInputElement>("radio")
        .every((input) => !input.checked);

    // 換到台中教堂又改回金華教堂：原本的拼布、便當、健行也不會留著。
    await user.click(button("修改場地"));
    await user.click(radio("場地", "台中教堂"));
    await user.click(radio("場地", "金華教堂"));
    await user.click(button("改好了，回到確認頁"));

    expect(step("選擇課程")).toBeTruthy();
    expect(screen.getByText("每個場次都要選一門課或「不選課」，請選擇還沒選的場次。")).toBeTruthy();
    expect(noneChecked("上午")).toBe(true);
    expect(noneChecked("下午")).toBe(true);

    // 選了課再回確認頁：午餐與午后動態也要重選。
    await user.click(radio("上午", "插花"));
    await user.click(radio("下午", "不選課"));
    await user.click(button("改好了，回到確認頁"));

    expect(step("午餐與服務")).toBeTruthy();
    expect(screen.getByText("請選一份午餐，或選「不需要」。")).toBeTruthy();
    expect(screen.getByText("請選一個午后動態，或選「不參加」。")).toBeTruthy();
    expect(noneChecked("午餐")).toBe(true);
    expect(noneChecked("午后動態")).toBe(true);
    // 紙本手冊不屬於場地，照樣是她原本選的。
    expect(radio("紙本手冊", "不需要紙本手冊").checked).toBe(true);
    expect(updateMine).not.toHaveBeenCalled();

    // 都重選了才送得出去，送出的只有新選的。
    await user.click(radio("午餐", "不需要"));
    await user.click(radio("午后動態", "不參加"));
    await user.click(button("改好了，回到確認頁"));
    updateMine.mockResolvedValueOnce({ ok: true, registration: found });
    await user.click(button("確認送出修改"));

    expect(updateMine).toHaveBeenCalledTimes(1);
    expect(updateMine).toHaveBeenLastCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          venueId: JINHUA,
          courseIds: [FLOWERS],
          lunchOptionId: null,
          afternoonActivityId: null,
          printedHandbook: false,
        }),
      }),
    );
  });

  // 確認頁的「確認送出修改」會把每一步再檢查一次：她在確認頁時名單可能剛好變了，例如場地多了一個場次。
  it("停在確認頁時場地多了一個還沒選的場次，按「確認送出修改」跳回選課那一步，不會送出", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RegistrationForm locale="zh" options={options} edit={edit} />);
    const evening = { id: id(14), name: "晚上", courses: [course(id(25), "烘焙")] };
    const withEvening: RegistrationOptions = {
      ...options,
      venues: options.venues.map((venue) =>
        venue.id === JINHUA ? { ...venue, sessions: [...venue.sessions, evening] } : venue,
      ),
    };

    rerender(<RegistrationForm locale="zh" options={withEvening} edit={edit} />);
    expect(step("確認修改")).toBeTruthy();
    await user.click(button("確認送出修改"));

    expect(step("選擇課程")).toBeTruthy();
    expect(screen.getByText("每個場次都要選一門課或「不選課」，請選擇還沒選的場次。")).toBeTruthy();
    expect(radio("上午", /拼布/).checked).toBe(true);
    expect(updateMine).not.toHaveBeenCalled();
  });
});

describe("頁面重新讀取選項", () => {
  it("修改時她原本已佔、現在已額滿的課程、午餐、午后動態仍選著、可送出；新選的額滿課程被取消並標出", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RegistrationForm locale="zh" options={options} edit={edit} />);

    await user.click(button("修改課程"));
    await user.click(radio("下午", "唱歌"));
    await user.click(button("改好了，回到確認頁"));
    expect(step("確認修改")).toBeTruthy();
    // 例如她送出失敗後頁面重新讀取：拼布、便當、健行（她的位子）和唱歌（新選的）都已額滿。
    rerender(
      <RegistrationForm locale="zh" options={withFull(QUILTING, BENTO, HIKING, SINGING)} edit={edit} />,
    );

    expect(step("選擇課程")).toBeTruthy();
    expect(screen.getByText("您選的課程剛剛被選滿了，請改選其他課程。其他資料都還在，不用重填。")).toBeTruthy();
    const quilting = radio("上午", /拼布/);
    expect(quilting.checked).toBe(true);
    expect(quilting.disabled).toBe(false);
    expect(within(group("上午")).queryByText("已額滿")).toBeNull();
    const singing = radio("下午", /唱歌/);
    expect(singing.checked).toBe(false);
    expect(singing.disabled).toBe(true);
    expect(within(group("下午")).getByText("已額滿")).toBeTruthy();

    await user.click(radio("下午", "不選課"));
    await user.click(button("下一步"));

    for (const [name, option] of [
      ["午餐", /^便當/],
      ["午后動態", /健行/],
    ] as const) {
      expect(radio(name, option).checked).toBe(true);
      expect(radio(name, option).disabled).toBe(false);
      expect(within(group(name)).queryByText("已額滿")).toBeNull();
    }

    updateMine.mockResolvedValueOnce({ ok: true, registration: found });
    await user.click(button("下一步"));
    await user.click(button("確認送出修改"));

    expect(updateMine).toHaveBeenCalledTimes(1);
    expect(updateMine).toHaveBeenLastCalledWith(
      expect.objectContaining({
        registrationId: found.id,
        changes: expect.objectContaining({
          courseIds: [QUILTING],
          lunchOptionId: BENTO,
          afternoonActivityId: HIKING,
        }),
      }),
    );
    expect(screen.getByRole("heading", { name: "修改完成" })).toBeTruthy();
  });

  it("報名時剛額滿的課程、午餐、午后動態被取消並標出，跳回選課那一步；改選後送出新選的", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RegistrationForm locale="zh" options={options} />);

    await user.type(screen.getByLabelText("姓名"), "王小美");
    await user.type(screen.getByLabelText("電話"), "0912345678");
    await user.click(radio("支聯會", "台北支聯會"));
    await user.click(radio("支會", "新店支會"));
    await user.click(button("下一步"));
    await user.click(radio("場地", "金華教堂"));
    await user.click(button("下一步"));
    await user.click(radio("上午", "拼布"));
    await user.click(radio("下午", "唱歌"));
    await user.click(button("下一步"));
    await user.click(radio("午餐", "便當"));
    await user.click(radio("午后動態", "健行"));
    await user.click(radio("紙本手冊", "需要紙本手冊"));
    await user.click(button("下一步"));
    expect(step("肖像權同意與確認")).toBeTruthy();

    rerender(<RegistrationForm locale="zh" options={withFull(QUILTING, BENTO, HIKING)} />);

    expect(step("選擇課程")).toBeTruthy();
    expect(screen.getByText("您選的課程剛剛被選滿了，請改選其他課程。其他資料都還在，不用重填。")).toBeTruthy();
    const quilting = radio("上午", /拼布/);
    expect(quilting.checked).toBe(false);
    expect(quilting.disabled).toBe(true);
    expect(within(group("上午")).getByText("已額滿")).toBeTruthy();
    // 還有名額的唱歌照樣選著。
    expect(radio("下午", "唱歌").checked).toBe(true);

    await user.click(radio("上午", "插花"));
    await user.click(button("下一步"));

    for (const [name, option] of [
      ["午餐", /^便當/],
      ["午后動態", /健行/],
    ] as const) {
      expect(radio(name, option).checked).toBe(false);
      expect(radio(name, option).disabled).toBe(true);
      expect(within(group(name)).getByText("已額滿")).toBeTruthy();
    }
    expect(screen.getByText("您選的午餐剛剛被訂完了，請改選其他午餐。其他資料都還在，不用重填。")).toBeTruthy();
    expect(
      screen.getByText("您選的午后動態剛剛額滿了，請改選其他活動或「不參加」。其他資料都還在，不用重填。"),
    ).toBeTruthy();
    expect(register).not.toHaveBeenCalled();

    await user.click(radio("午餐", "素食便當"));
    await user.click(radio("午后動態", "不參加"));
    await user.click(button("下一步"));
    await user.click(screen.getByRole("checkbox", { name: "我已閱讀並同意" }));
    register.mockResolvedValueOnce({ ok: true, registration: found });
    await user.click(button("確認送出報名"));

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenLastCalledWith(
      expect.objectContaining({
        venueId: JINHUA,
        lunchOptionId: VEGETARIAN,
        afternoonActivityId: null,
      }),
      expect.any(String),
    );
    // 課程的順序不影響報名。
    expect((register.mock.lastCall?.[0] as RegistrationInput).courseIds.toSorted()).toEqual([FLOWERS, SINGING]);
    expect(screen.getByRole("heading", { name: "報名完成" })).toBeTruthy();
  });
});
