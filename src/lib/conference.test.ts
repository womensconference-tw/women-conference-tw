import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient } from "../../test/supabase";
import { getCurrentConference } from "./conference";

const FIXTURE_YEAR = 2099;

// 2099 年度大會的三個時程時間點（台灣時間）
const ANNOUNCE_AT = "2099-03-01T09:00:00+08:00";
const OPENS_AT = "2099-04-01T09:00:00+08:00";
const CLOSES_AT = "2099-05-01T00:00:00+08:00";

const admin = adminClient();
let previousCurrentIds: string[] = [];

// Makes a fixture 年度大會 the 目前年度 for each test, then puts things back.
beforeEach(async () => {
  const { data } = await admin.from("conferences").select("id").eq("is_current", true);
  previousCurrentIds = (data ?? []).map((row) => row.id);
  await admin.from("conferences").update({ is_current: false }).eq("is_current", true);

  const { error } = await admin.from("conferences").insert({
    year: FIXTURE_YEAR,
    conference_date: "2099-05-15",
    announce_at: ANNOUNCE_AT,
    registration_opens_at: OPENS_AT,
    registration_closes_at: CLOSES_AT,
    is_current: true,
  });
  if (error) throw error;
});

afterEach(async () => {
  await admin.from("conferences").delete().eq("year", FIXTURE_YEAR);
  if (previousCurrentIds.length > 0) {
    await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds);
  }
});

describe("目前年度的時程", () => {
  it("報名開放到報名截止之間是報名中", async () => {
    const conference = await getCurrentConference(
      anonClient(),
      new Date("2099-04-15T12:00:00+08:00"),
    );

    expect(conference?.year).toBe(FIXTURE_YEAR);
    expect(conference?.phase).toBe("open");
  });

  it("公告上線前還沒有公告", async () => {
    const conference = await getCurrentConference(
      anonClient(),
      new Date("2099-02-01T12:00:00+08:00"),
    );

    expect(conference?.phase).toBe("unannounced");
  });

  it("公告上線到報名開放之間是報名前", async () => {
    const conference = await getCurrentConference(
      anonClient(),
      new Date("2099-03-15T12:00:00+08:00"),
    );

    expect(conference?.phase).toBe("upcoming");
  });

  it("報名截止之後是已截止", async () => {
    const conference = await getCurrentConference(
      anonClient(),
      new Date("2099-05-10T12:00:00+08:00"),
    );

    expect(conference?.phase).toBe("closed");
  });

  // 每個時間點屬於它開始的那個階段。
  it.each([
    { moment: "公告上線前一毫秒", now: "2099-03-01T08:59:59.999+08:00", phase: "unannounced" },
    { moment: "公告上線那一刻", now: ANNOUNCE_AT, phase: "upcoming" },
    { moment: "報名開放前一毫秒", now: "2099-04-01T08:59:59.999+08:00", phase: "upcoming" },
    { moment: "報名開放那一刻", now: OPENS_AT, phase: "open" },
    { moment: "報名截止前一毫秒", now: "2099-04-30T23:59:59.999+08:00", phase: "open" },
    { moment: "報名截止那一刻", now: CLOSES_AT, phase: "closed" },
  ])("$moment是 $phase", async ({ now, phase }) => {
    const conference = await getCurrentConference(anonClient(), new Date(now));

    expect(conference?.phase).toBe(phase);
  });
});
