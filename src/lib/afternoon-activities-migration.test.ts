import { readFileSync } from "node:fs";
import path from "node:path";
import type { TransactionSql } from "postgres";
import { describe, expect, it } from "vitest";
import { databaseClient } from "../../test/supabase";

/*
 * 午后動態改成場次（#65）：migration 把每個場地的午后動態轉成該場地最後一個場次裡的課程，
 * 已選的報名改成選了那門課。資料庫已經跑過這個 migration，所以測試在一個不提交的交易裡
 * 先把舊的午后動態資料表與欄位建回來、放進資料，再跑一次 migration 檢查結果。
 */

const migration = readFileSync(
  path.resolve(import.meta.dirname, "../../supabase/migrations/20261106000000_afternoon_activities_to_sessions.sql"),
  "utf8",
);

class Rollback extends Error {}

/** 在不提交的交易裡建好轉換前的資料，跑 migration，交給 check 檢查；結束後全部撤銷。 */
async function convert(check: (tx: TransactionSql, ids: Fixture) => Promise<void>) {
  const sql = databaseClient();
  try {
    await sql.begin(async (tx) => {
      const ids = await arrange(tx);
      await tx.unsafe(migration);
      // 延後到提交才檢查的限制（例如報名期間不能新增場次）在這裡就檢查，不必真的提交。
      await tx`set constraints all immediate`;
      await check(tx, ids);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    await sql.end();
  }
}

type Fixture = {
  conferenceId: string;
  jinhuaId: string;
  dayaId: string;
  wreathId: string;
  walkId: string;
  wreathTakerId: string;
  cancelledId: string;
  notJoiningId: string;
  walkTakerId: string;
};

/**
 * 一個報名中的年度：金華教堂有兩個場次與兩個午后動態（手作花圈限 20 人、已停止報名的聖殿巡禮不限），
 * 大雅教堂只有一個場次、沒有午后動態。報名有選花圈的、選了花圈但已取消的、不參加的、選聖殿巡禮的。
 */
async function arrange(tx: TransactionSql): Promise<Fixture> {
  await tx`
    create table public.afternoon_activities (
      id uuid primary key default gen_random_uuid(),
      conference_id uuid not null,
      venue_id uuid not null,
      position integer not null default 0,
      title_zh text not null,
      title_en text not null default '',
      description_zh text not null default '',
      description_en text not null default '',
      capacity integer,
      registration_stopped boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
  await tx`alter table public.registrations add column afternoon_activity_id uuid references public.afternoon_activities`;

  const [{ id: conferenceId }] = await tx`
    insert into public.conferences (year, conference_date) values (2098, '2098-05-15') returning id`;
  const [{ id: jinhuaId }] = await tx`
    insert into public.venues (conference_id, position, region, name_zh)
    values (${conferenceId}, 1, 'north', '台北金華教堂') returning id`;
  const [{ id: dayaId }] = await tx`
    insert into public.venues (conference_id, position, region, name_zh)
    values (${conferenceId}, 2, 'central', '台中大雅教堂') returning id`;
  await tx`
    insert into public.sessions (conference_id, venue_id, position, name_zh)
    values (${conferenceId}, ${jinhuaId}, 1, '第一場'), (${conferenceId}, ${jinhuaId}, 2, '第二場'),
      (${conferenceId}, ${dayaId}, 1, '第一場')`;
  const [{ id: wreathId }] = await tx`
    insert into public.afternoon_activities (
      conference_id, venue_id, position, title_zh, title_en, description_zh, description_en, capacity
    ) values (
      ${conferenceId}, ${jinhuaId}, 1, '手作花圈', 'Wreath making', '材料由大會提供', 'Materials provided', 20
    ) returning id`;
  const [{ id: walkId }] = await tx`
    insert into public.afternoon_activities (conference_id, venue_id, position, title_zh, registration_stopped)
    values (${conferenceId}, ${jinhuaId}, 2, '聖殿巡禮', true) returning id`;

  const [{ stake_id: stakeId, id: wardId }] = await tx`select stake_id, id from public.wards limit 1`;
  const register = async (activityId: string | null, status = "registered") => {
    const [{ id }] = await tx`
      insert into public.registrations (
        conference_id, venue_id, stake_id, ward_id, name, phone, portrait_consented_at, locale,
        afternoon_activity_id, status, cancelled_at
      ) values (
        ${conferenceId}, ${jinhuaId}, ${stakeId}, ${wardId}, '測試', ${`09${Math.random().toString().slice(2, 10)}`},
        now(), 'zh', ${activityId}, ${status}, ${status === "cancelled" ? new Date() : null}
      ) returning id`;
    return id as string;
  };
  const wreathTakerId = await register(wreathId);
  const cancelledId = await register(wreathId, "cancelled");
  const notJoiningId = await register(null);
  const walkTakerId = await register(walkId);

  // 先把建資料時延後的檢查做完，再開放報名：轉換是在報名期間發生的。
  await tx`set constraints all immediate`;
  await tx`set constraints all deferred`;
  await tx`
    update public.conferences
    set registration_opens_at = now() - interval '1 day', registration_closes_at = now() + interval '1 day'
    where id = ${conferenceId}`;

  return { conferenceId, jinhuaId, dayaId, wreathId, walkId, wreathTakerId, cancelledId, notJoiningId, walkTakerId };
}

describe("午后動態轉成場次的 migration", () => {
  it("每個有午后動態的場地多一個最後的場次「午后動態」，其他場地不變", async () => {
    await convert(async (tx, { jinhuaId, dayaId }) => {
      const sessions = await tx`
        select venue_id, position, name_zh, name_en from public.sessions
        where venue_id in (${jinhuaId}, ${dayaId}) order by venue_id = ${dayaId}, position`;
      expect(sessions.map(({ venue_id, ...session }) => ({ venue: venue_id === jinhuaId ? "金華" : "大雅", ...session }))).toEqual([
        { venue: "金華", position: 1, name_zh: "第一場", name_en: "" },
        { venue: "金華", position: 2, name_zh: "第二場", name_en: "" },
        { venue: "金華", position: 3, name_zh: "午后動態", name_en: "Afternoon activity" },
        { venue: "大雅", position: 1, name_zh: "第一場", name_en: "" },
      ]);
    });
  });

  it("午后動態變成這個場次的課程，id、名稱、說明、名額、排序、停止報名照舊", async () => {
    await convert(async (tx, { jinhuaId, wreathId, walkId }) => {
      const courses = await tx`
        select c.id, c.position, c.title_zh, c.title_en, c.description_zh, c.description_en, c.capacity,
          c.registration_stopped
        from public.courses c join public.sessions s on s.id = c.session_id
        where s.venue_id = ${jinhuaId} and s.name_zh = '午后動態'
        order by c.position`;
      expect(courses).toEqual([
        {
          id: wreathId, position: 1, title_zh: "手作花圈", title_en: "Wreath making",
          description_zh: "材料由大會提供", description_en: "Materials provided", capacity: 20,
          registration_stopped: false,
        },
        {
          id: walkId, position: 2, title_zh: "聖殿巡禮", title_en: "", description_zh: "", description_en: "",
          capacity: null, registration_stopped: true,
        },
      ]);
    });
  });

  it("已選的報名改成選了那門課（已取消的也保留紀錄），已報人數和轉換前一樣；沒選的是這個場次不選課", async () => {
    await convert(async (tx, ids) => {
      const choices = await tx`
        select rc.registration_id, rc.course_id
        from public.registration_courses rc join public.sessions s on s.id = rc.session_id
        where s.venue_id = ${ids.jinhuaId}`;
      expect(new Map(choices.map((row) => [row.registration_id, row.course_id]))).toEqual(
        new Map([
          [ids.wreathTakerId, ids.wreathId],
          [ids.cancelledId, ids.wreathId],
          [ids.walkTakerId, ids.walkId],
        ]),
      );
      const [taken] = await tx`
        select public.course_seats_taken(${ids.wreathId}) as wreath, public.course_seats_taken(${ids.walkId}) as walk`;
      expect(taken).toEqual({ wreath: 1, walk: 1 });
    });
  });

  it("轉換後午后動態的資料表與報名的欄位都移除了", async () => {
    await convert(async (tx) => {
      const [{ table, column }] = await tx`
        select to_regclass('public.afternoon_activities') as table,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'registrations' and column_name = 'afternoon_activity_id'
          ) as column`;
      expect({ table, column }).toEqual({ table: null, column: false });
    });
  });
});
