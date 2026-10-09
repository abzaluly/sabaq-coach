import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING } from "../../config/scoring";
import { basePoints } from "../../src/lib/scoring";
import { attempt, createGroup, createHabit, createUser, expectDenied, setClock, tx, type Db } from "./helpers";

/** 10:00 по Алматы (UTC+5) в указанный день 2026 года. */
const at = (date: string, time = "05:00") => `2026-${date}T${time}:00Z`;

async function tick(db: Db) {
  await db.as.admin();
  return (await db.query("select app_private.tick() as r")).rows[0].r as Record<string, number>;
}

let proofN = 0;
async function checkin(db: Db, user: string, habit: string, when: string, opts: { previousDay?: boolean } = {}) {
  await setClock(db, when);
  const { rows: h } = await db.query("select group_id, proof_type from public.habits where id = $1", [habit]);
  let proof: string | null = null;
  if (h[0].proof_type !== "honor") {
    await db.as.service();
    proof = (await db.query("select id from public.register_proof($1, $2, $3, null, null)", [user, h[0].group_id, `p/${proofN++}`])).rows[0].id;
  }
  await db.as.user(user);
  const { rows } = await db.query("select id from public.create_checkin($1, null, $3, $2)", [habit, opts.previousDay ?? false, proof]);
  await db.as.admin();
  return rows[0].id as string;
}

async function ledger(db: Db, user: string) {
  await db.as.admin();
  const { rows } = await db.query(
    "select event_type, amount::float as amount, details from public.points_ledger where user_id = $1 order by id",
    [user],
  );
  return rows as { event_type: string; amount: number; details: Record<string, unknown> }[];
}

async function balance(db: Db, user: string) {
  await db.as.admin();
  return Number((await db.query("select coalesce(sum(amount), 0) as b from public.points_ledger where user_id = $1", [user])).rows[0].b);
}

async function periods(db: Db, habit: string) {
  await db.as.admin();
  const { rows } = await db.query(
    "select period_start::text as start, status, done_count, required_count, streak_after from public.periods where habit_id = $1 order by period_start",
    [habit],
  );
  return rows;
}

async function setup(db: Db, opts: Parameters<typeof createHabit>[3] = {}) {
  await setClock(db, at("10-05"));
  const user = await createUser(db);
  const group = await createGroup(db, user);
  const habit = await createHabit(db, group, user, { activeFrom: "2026-10-05", proof: "photo", ...opts });
  return { user, group, habit };
}

describe("базовые очки", () => {
  it("TS-предпросмотр совпадает с серверной формулой для всех комбинаций", () =>
    tx(async (db) => {
      for (const frequency of ["daily", "weekly", "monthly"] as const)
        for (const difficulty of ["easy", "medium", "hard"] as const)
          for (const proof_type of ["photo", "honor"] as const) {
            const { rows } = await db.query(
              `select app_private.habit_base(row(null,null,null,'t','d',$1,1,$3,$2,'active',null,null,null,now(),null,null)::public.habits,
                 app_private.default_scoring_config())::float as b`,
              [frequency, difficulty, proof_type],
            );
            expect(rows[0].b, `${frequency}/${difficulty}/${proof_type}`).toBe(basePoints(DEFAULT_SCORING, { frequency, difficulty, proof_type }));
          }
    }));
});

describe("ежедневная привычка: стрики и пропуски", () => {
  it("одобренная отметка = 10 очков, стрик растёт и даёт бонус 10% × стрик", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db);
      for (const d of ["05", "06", "07"]) await checkin(db, user, habit, at(`10-${d}`));
      await setClock(db, at("10-09"));
      await tick(db);
      const l = await ledger(db, user);
      expect(l.filter((e) => e.event_type === "checkin").map((e) => e.amount)).toEqual([10, 10, 10]);
      expect(l.filter((e) => e.event_type === "streak_bonus").map((e) => e.amount)).toEqual([1, 2, 3]);
      // 8 октября пропущен
      expect(l.filter((e) => e.event_type === "miss_penalty").map((e) => e.amount)).toEqual([-5]);
      expect((await periods(db, habit)).map((p) => p.streak_after)).toEqual([1, 2, 3, 0, null]);
    }));

  it("множитель стрика ограничен ×2", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db);
      for (let d = 5; d <= 18; d++) await checkin(db, user, habit, at(`10-${String(d).padStart(2, "0")}`));
      await setClock(db, at("10-19", "21:00"));
      await tick(db);
      const bonuses = (await ledger(db, user)).filter((e) => e.event_type === "streak_bonus").map((e) => e.amount);
      expect(bonuses.slice(0, 3)).toEqual([1, 2, 3]);
      expect(bonuses.slice(9)).toEqual([10, 10, 10, 10, 10]); // стрик ≥ 10 → ×2 → +10
    }));

  it("пропуск сбрасывает стрик, следующий выполненный день начинает с 1", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db);
      await checkin(db, user, habit, at("10-05"));
      await checkin(db, user, habit, at("10-06"));
      await checkin(db, user, habit, at("10-08"));
      await setClock(db, at("10-09", "21:00"));
      await tick(db);
      expect((await periods(db, habit)).map((p) => p.streak_after).slice(0, 4)).toEqual([1, 2, 0, 1]);
    }));

  it("дни до первой отметки тоже штрафуются", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db);
      await checkin(db, user, habit, at("10-08"));
      await setClock(db, at("10-09"));
      await tick(db);
      expect((await ledger(db, user)).filter((e) => e.event_type === "miss_penalty")).toHaveLength(3);
    }));

  it("honor ×0.5 и сложность ×1.5", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db, { proof: "honor" });
      await db.query("update public.habits set difficulty = 'hard' where id = $1", [habit]);
      await checkin(db, user, habit, at("10-05"));
      await setClock(db, at("10-06", "21:00"));
      await tick(db);
      expect((await ledger(db, user)).find((e) => e.event_type === "checkin")?.amount).toBe(7.5);
    }));
});

describe("привычки «N раз за период»", () => {
  it("3 раза в неделю: 10 за отметку + 20% за полную неделю + стрик", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db, { frequency: "weekly", target: 3 });
      for (const d of ["05", "07", "09"]) await checkin(db, user, habit, at(`10-${d}`));
      await setClock(db, at("10-12", "21:00")); // понедельник после grace, отметки уже решены
      await tick(db);
      const l = await ledger(db, user);
      expect(l.map((e) => [e.event_type, e.amount])).toEqual([
        ["checkin", 10],
        ["checkin", 10],
        ["checkin", 10],
        ["period_bonus", 6],
        ["streak_bonus", 3.6],
      ]);
    }));

  it("частичное выполнение: очки за отметки остаются, без бонусов и штрафа, стрик = 0", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db, { frequency: "weekly", target: 3 });
      await checkin(db, user, habit, at("10-05"));
      await checkin(db, user, habit, at("10-06"));
      await setClock(db, at("10-12", "21:00"));
      await tick(db);
      expect((await ledger(db, user)).map((e) => e.event_type)).toEqual(["checkin", "checkin"]);
      expect((await periods(db, habit))[0]).toMatchObject({ status: "settled", done_count: 2, required_count: 3, streak_after: 0 });
    }));

  it("переход месяца: месячная привычка подводится 1-го числа по часовому поясу группы", () =>
    tx(async (db) => {
      await setClock(db, at("10-01"));
      const user = await createUser(db);
      const group = await createGroup(db, user);
      const habit = await createHabit(db, group, user, { frequency: "monthly", target: 2, activeFrom: "2026-10-01", proof: "photo" });
      await checkin(db, user, habit, at("10-10"));
      await checkin(db, user, habit, at("10-31", "18:00")); // 23:00 31 октября в Алматы
      await setClock(db, "2026-10-31T19:30:00Z"); // 00:30 1 ноября — grace ещё идёт
      await tick(db);
      expect((await periods(db, habit))[0].status).toBe("open");
      await setClock(db, "2026-11-01T19:00:00Z"); // отметки решены, grace прошёл
      await tick(db);
      const p = await periods(db, habit);
      expect(p[0]).toMatchObject({ start: "2026-10-01", status: "settled", streak_after: 1 });
      expect(p[1]).toMatchObject({ start: "2026-11-01", status: "open" });
      // 50 + 50 + бонус 20 + стрик (120 × 0.1)
      expect(await balance(db, user)).toBe(132);
    }));

  it("неделя на стыке месяцев считается одним периодом", () =>
    tx(async (db) => {
      await setClock(db, at("10-26"));
      const user = await createUser(db);
      const group = await createGroup(db, user);
      const habit = await createHabit(db, group, user, { frequency: "weekly", target: 2, activeFrom: "2026-10-26", proof: "photo" });
      await checkin(db, user, habit, at("10-30"));
      await checkin(db, user, habit, at("11-01"));
      await setClock(db, at("11-02", "21:00"));
      await tick(db);
      expect((await periods(db, habit))[0]).toMatchObject({ start: "2026-10-26", done_count: 2, streak_after: 1 });
    }));
});

describe("заморозки", () => {
  it("замороженный день: без штрафа, стрик не растёт и не сгорает", () =>
    tx(async (db) => {
      const { user, group, habit } = await setup(db);
      await checkin(db, user, habit, at("10-05"));
      await db.as.user(user);
      await db.query("select public.declare_freeze($1, '2026-10-06', '2026-10-07', 'Болею')", [group]);
      await checkin(db, user, habit, at("10-08"));
      await setClock(db, at("10-09", "06:00")); // 8-е подведено, 9-е ещё идёт
      await tick(db);
      expect((await periods(db, habit)).map((p) => p.streak_after).slice(0, 4)).toEqual([1, 1, 1, 2]);
      expect((await ledger(db, user)).some((e) => e.event_type === "miss_penalty")).toBe(false);
    }));

  it("заморозка части недели пропорционально уменьшает N", () =>
    tx(async (db) => {
      const { user, group, habit } = await setup(db, { frequency: "weekly", target: 3 });
      await db.as.user(user);
      await db.query("select public.declare_freeze($1, '2026-10-07', '2026-10-09', 'Поездка')", [group]);
      await checkin(db, user, habit, at("10-05"));
      await checkin(db, user, habit, at("10-10"));
      await setClock(db, at("10-12", "21:00"));
      await tick(db);
      // round(3 × 4/7) = 2 — выполнено полностью
      expect((await periods(db, habit))[0]).toMatchObject({ required_count: 2, done_count: 2, streak_after: 1 });
    }));

  it("заморозку можно объявить только заранее и не больше лимита за сезон", () =>
    tx(async (db) => {
      const { user, group } = await setup(db);
      await db.as.user(user);
      await expectDenied(db, "select public.declare_freeze($1, '2026-10-05', '2026-10-05', 'Болею')", [group], "freeze_too_late");
      await expectDenied(db, "select public.declare_freeze($1, '2026-10-06', '2026-10-06', '')", [group], "comment_required");
      await db.query("select public.declare_freeze($1, '2026-10-06', '2026-10-06', 'a')", [group]);
      await expectDenied(db, "select public.declare_freeze($1, '2026-10-06', '2026-10-07', 'b')", [group], "invalid_freeze");
      await db.query("select public.declare_freeze($1, '2026-10-08', '2026-10-08', 'b')", [group]);
      await expectDenied(db, "select public.declare_freeze($1, '2026-10-10', '2026-10-10', 'c')", [group], "freeze_limit_reached");
      await expectDenied(db, "select public.create_checkin(gen_random_uuid())", [], "habit_not_found");
    }));

  it("в замороженный день нельзя отметиться", () =>
    tx(async (db) => {
      const { user, group, habit } = await setup(db);
      await db.as.user(user);
      await db.query("select public.declare_freeze($1, '2026-10-06', '2026-10-06', 'a')", [group]);
      await setClock(db, at("10-06"));
      await db.as.user(user);
      await expectDenied(db, "select public.create_checkin($1)", [habit], "day_frozen");
    }));
});

describe("фейки", () => {
  it("отклонённая на проверке отметка: штраф ×3 от базы отметки, очков не было", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      const h = await createHabit(db, g, a, { activeFrom: "2026-10-05", proof: "photo" });
      const c = await checkin(db, a, h, at("10-05"));
      await db.as.user(b);
      await db.query("select public.vote_checkin($1, 'dispute', 'фото чужое')", [c]);
      expect((await ledger(db, a)).map((e) => [e.event_type, e.amount])).toEqual([["fake_penalty", -30]]);
    }));

  it("отклонённая модератором одобренная отметка: отзыв + штраф; повтор не дублирует", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, b, { members: [a] });
      const h = await createHabit(db, g, a, { activeFrom: "2026-10-05", proof: "photo" });
      const c = await checkin(db, a, h, at("10-05"));
      await setClock(db, at("10-06", "12:00"));
      await tick(db);
      await db.as.user(b);
      await db.query("select public.moderate_checkin($1, 'Фото из интернета')", [c]);
      await db.query("select public.moderate_checkin($1, 'ещё раз')", [c]);
      const l = await ledger(db, a);
      expect(l.filter((e) => e.event_type !== "streak_bonus").map((e) => [e.event_type, e.amount])).toEqual([
        ["checkin", 10],
        ["fake_revoke", -10],
        ["fake_penalty", -30],
      ]);
    }));
});

describe("крон закрытия периодов", () => {
  it("повторный запуск ничего не начисляет дважды", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db, { frequency: "weekly", target: 2 });
      await checkin(db, user, habit, at("10-05"));
      await checkin(db, user, habit, at("10-06"));
      await setClock(db, at("10-13"));
      const first = await tick(db);
      expect(first.periods_settled).toBe(1);
      const before = await ledger(db, user);
      const second = await tick(db);
      expect(second).toMatchObject({ periods_settled: 0, checkins_decided: 0 });
      expect(await ledger(db, user)).toEqual(before);
      await db.as.admin();
      const pid = (await db.query("select id from public.periods where habit_id = $1 order by period_start limit 1", [habit])).rows[0].id;
      expect((await db.query("select app_private.settle_period($1) as r", [pid])).rows[0].r).toBe("already");
    }));

  it("период не подводится, пока его отметки на проверке", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      const h = await createHabit(db, g, a, { activeFrom: "2026-10-05", proof: "photo" });
      await checkin(db, a, h, at("10-05", "18:30")); // 23:30 — окно проверки до 23:30 следующего дня
      await setClock(db, at("10-06", "05:00"));
      await tick(db);
      expect((await periods(db, h))[0].status).toBe("open");
      await setClock(db, at("10-06", "19:00"));
      await tick(db);
      expect((await periods(db, h))[0]).toMatchObject({ status: "settled", streak_after: 1 });
    }));

  it("смена часового пояса группы не ломает и не дублирует подведение", () =>
    tx(async (db) => {
      const { user, group, habit } = await setup(db);
      await checkin(db, user, habit, at("10-05"));
      await db.as.user(user);
      await db.query("select public.update_group_settings($1, p_timezone => 'America/New_York')", [group]);
      await setClock(db, at("10-06"));
      await tick(db); // применяет смену таймзоны (наступил 6-е по Алматы)
      await db.as.admin();
      expect((await db.query("select timezone from public.groups where id = $1", [group])).rows[0].timezone).toBe("America/New_York");
      // 6-е по Нью-Йорку (UTC−4) — отмечаемся днём по их времени
      await checkin(db, user, habit, "2026-10-06T16:00:00Z");
      await setClock(db, "2026-10-08T12:00:00Z");
      await tick(db);
      await tick(db);
      const p = await periods(db, habit);
      expect(p.map((x) => x.start)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
      expect(p.map((x) => x.streak_after)).toEqual([1, 2, 0, null]);
      expect((await ledger(db, user)).filter((e) => e.event_type === "checkin")).toHaveLength(2);
    }));

  it("клиент не может запустить крон", () =>
    tx(async (db) => {
      const user = await createUser(db);
      await db.as.user(user);
      const err = await attempt(db, "select public.run_tick()");
      expect(err?.code).toBe("42501");
    }));

  it("архивированная привычка: текущий период подводится, следующие не создаются", () =>
    tx(async (db) => {
      const { user, habit } = await setup(db);
      await db.as.user(user);
      await db.query("select public.archive_habit($1)", [habit]); // действует до 6-го
      await setClock(db, at("10-09"));
      await tick(db);
      const p = await periods(db, habit);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ start: "2026-10-05", status: "settled", streak_after: 0 });
      expect((await ledger(db, user)).map((e) => e.event_type)).toEqual(["miss_penalty"]);
    }));

  it("изменённая привычка продолжает стрик старой", () =>
    tx(async (db) => {
      const { user, group, habit } = await setup(db);
      await checkin(db, user, habit, at("10-05"));
      await db.as.user(user);
      const next = (
        await db.query(
          "select id, active_from::text from public.propose_habit($1, 'Отжимания 40', 'Сорок отжиманий подряд', 'daily', 1, 'honor', 'medium', $2)",
          [group, habit],
        )
      ).rows[0];
      expect(next.active_from).toBe("2026-10-06");
      await checkin(db, user, next.id, at("10-06"));
      await setClock(db, at("10-07", "21:00"));
      await tick(db);
      expect((await periods(db, next.id))[0]).toMatchObject({ start: "2026-10-06", streak_after: 2 });
      expect(await periods(db, habit)).toHaveLength(1);
    }));
});

describe("сезоны и лидерборд", () => {
  it("сезон закрывается и начинается следующий; лидерборд по сезону и за всё время", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      await db.as.user(a);
      const g = (await db.query("select id from public.create_group('S', 'Asia/Almaty', 7)")).rows[0].id;
      await db.as.admin();
      await db.query("insert into public.group_members (group_id, user_id) values ($1, $2)", [g, b]);
      const ha = await createHabit(db, g, a, { activeFrom: "2026-10-05", proof: "photo" });
      await checkin(db, a, ha, at("10-05"));
      await setClock(db, at("10-12"));
      const r = await tick(db);
      expect(r.seasons_rolled).toBe(1);
      const seasons = (await db.query("select number, status, starts_on::text from public.seasons where group_id = $1 order by number", [g])).rows;
      expect(seasons).toEqual([
        { number: 1, status: "closed", starts_on: "2026-10-05" },
        { number: 2, status: "active", starts_on: "2026-10-12" },
      ]);
      await db.as.user(b);
      const all = (await db.query("select user_id, points::float, rank::int from public.leaderboard($1, 'all')", [g])).rows;
      // A: 10 + 1 (стрик) − 6 пропусков × 5 = −19; B без привычек — 0.
      expect(all).toEqual([
        { user_id: b, points: 0, rank: 1 },
        { user_id: a, points: -19, rank: 2 },
      ]);
      const season = (await db.query("select points::float from public.leaderboard($1, 'season')", [g])).rows;
      expect(season.every((r) => r.points === 0)).toBe(true);
      const mallory = await createUser(db);
      await db.as.user(mallory);
      await expectDenied(db, "select * from public.leaderboard($1)", [g], "not_a_member");
    }));
});
