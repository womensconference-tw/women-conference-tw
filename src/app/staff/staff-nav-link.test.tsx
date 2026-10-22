// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StaffNavLink } from "./staff-nav-link";

const navigation = vi.hoisted(() => ({ pathname: "/staff" }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => navigation.pathname,
}));

afterEach(cleanup);

function renderNav(pathname: string) {
  navigation.pathname = pathname;
  render(
    <nav>
      <StaffNavLink href="/staff">後台首頁</StaffNavLink>
      <StaffNavLink href="/staff/registrations">報名名單</StaffNavLink>
    </nav>,
  );
}

it("在後台首頁時只標出「後台首頁」", () => {
  renderNav("/staff");
  expect(screen.getByRole("link", { name: "後台首頁" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "報名名單" }).getAttribute("aria-current")).toBeNull();
});

it("在報名名單底下的頁面時標出「報名名單」，不標「後台首頁」", () => {
  renderNav("/staff/registrations/abc");
  expect(screen.getByRole("link", { name: "報名名單" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "後台首頁" }).getAttribute("aria-current")).toBeNull();
});
