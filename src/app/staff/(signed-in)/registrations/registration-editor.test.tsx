// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistrationForEdit } from "@/lib/registration-list";
import type { RegistrationOptions } from "@/lib/registration-options";
import type { StaffFormResult } from "./actions";
import { RegistrationEditor } from "./registration-editor";

// 伺服器動作換成假的，由測試決定什麼時候回應、回應什麼。
const editRegistration =
  vi.fn<(id: unknown, input: unknown, confirmFull: unknown, submissionKey: unknown) => Promise<StaffFormResult>>();
vi.mock("./actions", () => ({
  addRegistration: vi.fn(),
  editRegistration: (id: unknown, input: unknown, confirmFull: unknown, submissionKey: unknown) =>
    editRegistration(id, input, confirmFull, submissionKey),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const VENUE = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-000000000002";
const QUILTING = "00000000-0000-4000-8000-000000000003";
const FLOWERS = "00000000-0000-4000-8000-000000000004";
const SINGING = "00000000-0000-4000-8000-000000000005";

// 一個場地、一個場次：拼布、插花都已額滿，唱歌還有名額。
const options: RegistrationOptions = {
  venues: [
    {
      id: VENUE,
      name: "金華教堂",
      sessions: [
        {
          id: SESSION,
          name: "上午",
          courses: [
            { id: QUILTING, name: "拼布", description: "", isFull: true, pairedWith: null },
            { id: FLOWERS, name: "插花", description: "", isFull: true, pairedWith: null },
            { id: SINGING, name: "唱歌", description: "", isFull: false, pairedWith: null },
          ],
        },
      ],
      lunchOptions: [],
    },
  ],
  stakes: [],
};

// 她原本選了唱歌。
const registration: RegistrationForEdit = {
  id: "00000000-0000-4000-8000-000000000009",
  name: "王小美",
  phone: "0912345678",
  registrationNumber: null,
  email: null,
  lineId: null,
  stakeId: "00000000-0000-4000-8000-00000000000a",
  wardId: "00000000-0000-4000-8000-00000000000b",
  venueId: VENUE,
  courseIds: [SINGING],
  lunchOptionId: null,
  choirPart: null,
  services: [],
  printedHandbook: false,
  role: "attendee",
  status: "registered",
  stakeName: "台北支聯會",
  wardName: "新店支會",
  isCurrentYear: true,
};

/** 還沒回應的伺服器動作；呼叫 resolve 才回應。 */
function deferred() {
  let resolve!: (result: StaffFormResult) => void;
  const promise = new Promise<StaffFormResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const needsConfirmation: StaffFormResult = {
  ok: false,
  errors: { courses: "courseFull" },
  fullIds: [QUILTING],
  needsConfirmation: true,
  fullOptions: ["課程「拼布」：名額 30 人，目前已報 30 人，加入後變成 31 人（超過名額 1 人）"],
};

beforeAll(() => {
  // jsdom 沒有實作對話框的開關，補上最基本的行為。
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  editRegistration.mockReset();
  push.mockReset();
});

afterEach(cleanup);

describe("後台修改報名的超收確認", () => {
  it("送出中不能改欄位", async () => {
    const user = userEvent.setup();
    const response = deferred();
    editRegistration.mockReturnValueOnce(response.promise);
    render(<RegistrationEditor options={options} registration={registration} />);

    await user.selectOptions(screen.getByLabelText("上午"), QUILTING);
    await user.click(screen.getByRole("button", { name: "儲存修改" }));

    // 欄位放在停用的 fieldset 裡，本身沒有 disabled 屬性，用 :disabled 判斷。
    expect(screen.getByLabelText("上午").matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "處理中…" }).matches(":disabled")).toBe(true);
    await act(async () => response.resolve(needsConfirmation));
    expect(screen.getByLabelText("上午").matches(":disabled")).toBe(false);
  });

  it("額滿時先跳出提示，按「確定加入」才帶確認旗標，重送提示裡的那份內容", async () => {
    const user = userEvent.setup();
    editRegistration.mockResolvedValueOnce(needsConfirmation);
    editRegistration.mockResolvedValueOnce({ ok: true, registration: { ...registration, courseIds: [QUILTING] } });
    render(<RegistrationEditor options={options} registration={registration} />);

    await user.selectOptions(screen.getByLabelText("上午"), QUILTING);
    await user.click(screen.getByRole("button", { name: "儲存修改" }));

    // 測試環境的對話框不會擋住背景，查詢要包含隱藏的元素；所以另外確認對話框真的打開了。
    const dialog = screen.getByRole<HTMLDialogElement>("alertdialog", { hidden: true });
    expect(dialog.open).toBe(true);
    expect(within(dialog).getByText("課程「拼布」：名額 30 人，目前已報 30 人，加入後變成 31 人（超過名額 1 人）")).toBeTruthy();
    expect(editRegistration).toHaveBeenLastCalledWith(
      registration.id,
      expect.objectContaining({ courseIds: [QUILTING] }),
      false,
      expect.any(String),
    );

    // 提示開著時改選另一門額滿的課，再按「確定加入」：送出的仍是提示裡的拼布，插花沒有被超收。
    await user.selectOptions(screen.getByLabelText("上午"), FLOWERS);
    await user.click(within(dialog).getByRole("button", { name: "確定加入", hidden: true }));

    expect(editRegistration).toHaveBeenCalledTimes(2);
    expect(editRegistration).toHaveBeenLastCalledWith(
      registration.id,
      expect.objectContaining({ courseIds: [QUILTING] }),
      true,
      expect.any(String),
    );
    expect(push).toHaveBeenCalledWith("/staff/registrations?done=updated");
  });

  it("按「取消」就不送出，對話框關掉；之後再按「儲存修改」會重新問，不會直接超收", async () => {
    const user = userEvent.setup();
    editRegistration.mockResolvedValue(needsConfirmation);
    render(<RegistrationEditor options={options} registration={registration} />);
    const dialog = screen.getByRole<HTMLDialogElement>("alertdialog", { hidden: true });

    await user.selectOptions(screen.getByLabelText("上午"), QUILTING);
    await user.click(screen.getByRole("button", { name: "儲存修改" }));
    await user.click(screen.getByRole("button", { name: "取消", hidden: true }));

    expect(dialog.open).toBe(false);
    expect(editRegistration).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "儲存修改" }));

    expect(editRegistration).toHaveBeenCalledTimes(2);
    expect(editRegistration).toHaveBeenLastCalledWith(
      registration.id,
      expect.objectContaining({ courseIds: [QUILTING] }),
      false,
      expect.any(String),
    );
    expect(dialog.open).toBe(true);
  });
});

describe("後台修改報名的送出編號", () => {
  const keys = () => editRegistration.mock.calls.map((call) => call[3]);

  it("回應斷掉後再按一次，沿用同一個送出編號；收到回應後（例如要確認超收）換新的", async () => {
    const user = userEvent.setup();
    editRegistration.mockRejectedValueOnce(new Error("network"));
    editRegistration.mockResolvedValueOnce(needsConfirmation);
    editRegistration.mockResolvedValueOnce({ ok: true, registration: { ...registration, courseIds: [QUILTING] } });
    render(<RegistrationEditor options={options} registration={registration} />);

    await user.selectOptions(screen.getByLabelText("上午"), QUILTING);
    await user.click(screen.getByRole("button", { name: "儲存修改" }));
    await user.click(screen.getByRole("button", { name: "儲存修改" }));
    const dialog = screen.getByRole<HTMLDialogElement>("alertdialog", { hidden: true });
    await user.click(within(dialog).getByRole("button", { name: "確定加入", hidden: true }));

    expect(keys()).toHaveLength(3);
    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).not.toBe(keys()[1]);
  });

  // 「系統出了問題」可能是資料庫已經存好、回應才斷掉，不能確定沒存到。
  it("回應是系統出了問題時，再按一次也沿用同一個送出編號", async () => {
    const user = userEvent.setup();
    editRegistration.mockResolvedValueOnce({ ok: false, errors: { form: "unknown" } });
    editRegistration.mockResolvedValueOnce({ ok: false, errors: { form: "unknown" } });
    render(<RegistrationEditor options={options} registration={registration} />);

    await user.selectOptions(screen.getByLabelText("上午"), QUILTING);
    await user.click(screen.getByRole("button", { name: "儲存修改" }));
    await user.click(screen.getByRole("button", { name: "儲存修改" }));

    expect(keys()).toHaveLength(2);
    expect(keys()[1]).toBe(keys()[0]);
  });

  it("內容改了再送，換新的送出編號", async () => {
    const user = userEvent.setup();
    editRegistration.mockRejectedValueOnce(new Error("network"));
    editRegistration.mockRejectedValueOnce(new Error("network"));
    render(<RegistrationEditor options={options} registration={registration} />);

    await user.selectOptions(screen.getByLabelText("上午"), QUILTING);
    await user.click(screen.getByRole("button", { name: "儲存修改" }));
    await user.selectOptions(screen.getByLabelText("上午"), FLOWERS);
    await user.click(screen.getByRole("button", { name: "儲存修改" }));

    expect(keys()).toHaveLength(2);
    expect(keys()[0]).not.toBe(keys()[1]);
  });
});
