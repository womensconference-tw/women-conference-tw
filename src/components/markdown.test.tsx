// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommitteeTexts } from "./committee";
import { Markdown } from "./markdown";

/*
 * 籌備委員會文字頁的 Markdown 排版（#75）。
 */

afterEach(cleanup);

const show = (text: string) => render(<Markdown>{text}</Markdown>).container;

it("排出標題、粗體、項目清單、連結", () => {
  const page = show("# 宗旨\n\n**（2026 年度修正）**\n\n- 第一點\n- 第二點\n\n[舊網站](https://example.org/a)");
  expect(page.querySelector("h3")?.textContent).toBe("宗旨");
  expect(page.querySelector("strong")?.textContent).toBe("（2026 年度修正）");
  expect([...page.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["第一點", "第二點"]);
  const link = page.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://example.org/a");
  expect(link.textContent).toContain("舊網站");
});

it("外部連結在新分頁開", () => {
  const link = show("[舊網站](https://example.org/a)").querySelector("a")!;
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
});

it("多層編號清單依序是 1. → A. → a. → 1)", () => {
  const page = show("1. 甲\n    1. 乙\n        1. 丙\n            1. 丁\n2. 戊");
  const levels = [...page.querySelectorAll("ol")].map((ol) => ol.className);
  expect(levels).toHaveLength(4);
  expect(levels[0]).toContain("list-decimal");
  expect(levels[1]).toContain("list-[upper-alpha]");
  expect(levels[2]).toContain("list-[lower-alpha]");
  expect(levels[3]).toContain("list-[paren-decimal]");
});

it("表格包在可以左右捲動的框裡", () => {
  const page = show("| 組別 | 姓名 |\n| --- | --- |\n| 課務組 | 測試甲 |");
  const table = page.querySelector("table")!;
  expect(table.parentElement?.className).toContain("overflow-x-auto");
  expect([...table.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["組別", "姓名"]);
  expect(table.querySelector("td")?.textContent).toBe("課務組");
});

it("舊的純文字內容：每個換行都保留", () => {
  const page = show("第一行\n第二行\n\n第三段");
  const paragraphs = page.querySelectorAll("p");
  expect(paragraphs).toHaveLength(2);
  expect(paragraphs[0].querySelector("br")).toBeTruthy();
  expect(paragraphs[0].textContent).toBe("第一行\n第二行");
  expect(paragraphs[1].textContent).toBe("第三段");
});

it("HTML 不會進到頁面：script、iframe、onclick 都當成文字或拿掉", () => {
  const page = show(
    '<script>alert(1)</script>\n\n<iframe src="https://evil.invalid"></iframe>\n\n<b onclick="alert(1)">粗</b>\n\n<img src=x onerror="alert(1)">',
  );
  for (const tag of ["script", "iframe", "b", "img"]) expect(page.querySelector(tag)).toBeNull();
  expect(page.querySelector("[onclick], [onerror]")).toBeNull();
});

it("連結只接受 http(s)：javascript:、data:、mailto: 等只顯示文字", () => {
  const page = show(
    [
      "[a](javascript:alert(1))",
      "[b](JaVaScRiPt:alert(1))",
      "[c](data:text/html;base64,PHNjcmlwdD4=)",
      "[d](vbscript:msgbox)",
      "[e](mailto:someone@example.org)",
      "[f](/staff)",
      "<javascript:alert(1)>",
      "[g](https://)",
    ].join("\n\n"),
  );
  expect(page.querySelector("a")).toBeNull();
  expect(page.textContent).toContain("a");
  expect(page.textContent).toContain("f");
});

it("圖片不顯示，只留替代文字", () => {
  const page = show("![追蹤用圖片](https://example.org/pixel.png)");
  expect(page.querySelector("img")).toBeNull();
  expect(page.textContent).toContain("追蹤用圖片");
});

it("自動連結也只接受 http(s)，並在新分頁開", () => {
  const link = show("網址 https://example.org/b 在這裡").querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://example.org/b");
  expect(link.getAttribute("target")).toBe("_blank");
});

it("縮排的文字（舊的純文字內容或往內縮一層）照樣用一般字型顯示，保留換行", () => {
  const block = show("前言\n\n    縮排的第一行\n    縮排的第二行").querySelector("pre")!;
  expect(block.className).toContain("font-sans");
  expect(block.textContent).toBe("縮排的第一行\n縮排的第二行\n");
});

it("標題裡很長的英文字會斷行，手機上不撐出橫向捲動（Codex 審查）", () => {
  const page = show("# AnnualWomensConference2026PlanningCommitteeMemorandum\n\n## 二\n\n### 三\n\n#### 四");
  for (const heading of page.querySelectorAll("h3, h4, h5, h6")) expect(heading.className).toContain("break-words");
});

it("改版前存的純文字照原樣顯示：空格、空行、星號都不變（#75，Codex 審查）", () => {
  const { container } = render(
    <CommitteeTexts texts={{ introduction: "甲  乙\n\n\n\n*注意*\n# 說明", chairMessage: "", memorandum: "", markdown: false }} />,
  );
  const text = container.querySelector("p.whitespace-pre-wrap")!;
  expect(text.textContent).toBe("甲  乙\n\n\n\n*注意*\n# 說明");
  expect(container.querySelector("em, h3")).toBeNull();
});

it("用新的編輯框存過的依 Markdown 排版", () => {
  const { container } = render(
    <CommitteeTexts texts={{ introduction: "*注意*", chairMessage: "", memorandum: "", markdown: true }} />,
  );
  expect(container.querySelector("em")?.textContent).toBe("注意");
});

it("大會特色介紹頁（images）顯示後台上傳的圖片；別的網站的圖片、籌備委員會文字頁只留圖片說明（#102）", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  const ours =
    "http://127.0.0.1:55321/storage/v1/object/public/highlight-images/00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-000000000001.png";
  const text = `![練唱場地](${ours})\n\n![外面的圖](https://example.org/a.png)`;
  const page = render(<Markdown images>{text}</Markdown>).container;
  expect([...page.querySelectorAll("img")].map((img) => [img.getAttribute("src"), img.getAttribute("alt")])).toEqual([[ours, "練唱場地"]]);
  expect(page.textContent).toContain("外面的圖");
  cleanup();
  const committee = show(text);
  expect(committee.querySelector("img")).toBeNull();
  expect(committee.textContent).toContain("練唱場地");
  vi.unstubAllEnvs();
});

it("置中、靠右的標題與段落；不認得的 ::: 寫法照原文顯示（#102）", () => {
  const page = show(":::center\n# 歡迎\n:::\n\n:::right\n籌備委員會\n:::\n\n:::note\n小心\n:::\n\n時間 9:00，Note:bring");
  expect(page.querySelector("h3")?.className).toContain("text-center");
  expect(page.querySelector("p")?.className).toContain("text-right");
  expect(page.textContent).toContain(":::note");
  expect(page.textContent).toContain("時間 9:00，Note:bring");
});

it("大會特色的圖片依大小設寬度，沒有大小是滿版；標題不畫成提示文字（#102）", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  const url = (n: number) =>
    `http://127.0.0.1:55321/storage/v1/object/public/highlight-images/00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-00000000000${n}.png`;
  const page = render(
    <Markdown images>{`:::center\n![小](${url(1)} "small")\n:::\n\n![滿](${url(2)})`}</Markdown>,
  ).container;
  const [small, full] = page.querySelectorAll("img");
  expect(small.className).toContain("w-1/3");
  expect(small.getAttribute("title")).toBeNull();
  expect(small.parentElement?.className).toContain("text-center");
  expect(full.className).toContain("w-full");
  vi.unstubAllEnvs();
});
