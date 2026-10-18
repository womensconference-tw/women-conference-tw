import { describe, expect, it } from "vitest";
import { nextSubmission } from "./submission-key";

describe("送出編號", () => {
  let count = 0;
  const newKey = () => `key-${++count}`;

  it("第一次送出拿到新的編號", () => {
    expect(nextSubmission(null, { name: "王小美" }, newKey).key).toMatch(/^key-/);
  });

  it("同一份內容重按時沿用同一個編號", () => {
    const first = nextSubmission(null, { name: "王小美", courseIds: ["a"] }, newKey);
    const again = nextSubmission(first, { name: "王小美", courseIds: ["a"] }, newKey);

    expect(again.key).toBe(first.key);
  });

  it("內容改了就換新的編號", () => {
    const first = nextSubmission(null, { name: "王小美", courseIds: ["a"] }, newKey);
    const changed = nextSubmission(first, { name: "王小美", courseIds: ["b"] }, newKey);

    expect(changed.key).not.toBe(first.key);
  });
});
