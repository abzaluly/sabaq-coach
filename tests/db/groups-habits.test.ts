import { describe, expect, it } from "vitest";
import { attempt, createGroup, createUser, expectDenied, setClock, tx, type Db } from "./helpers";

// Пятница 9 октября 2026, 10:00 в Алматы.
const FRIDAY = "2026-10-09T05:00:00Z";
// Понедельник 12 октября 2026, 10:00 в Алматы.
const MONDAY = "2026-10-12T05:00:00Z";

async function propose(
  db: Db,
  user: string,
  group: string,
  opts: { frequency?: string; target?: number; replaces?: string | null; title?: string } = {},
) {
  await db.as.user(user);
  const { rows } = await db.query(
    `select * from public.propose_habit($1, $2, 'Каждый день 30 отжиманий подряд', $3, $4, 'photo', 'medium', $5)`,
    [group, opts.title ?? "Отжимания", opts.frequency ?? "daily", opts.target ?? 1, opts.replaces ?? null],
  );
  return rows[0] as { id: string; status: string; active_from: string | null };
}

describe("группы и инвайты", () => {
  it("создатель становится owner, создаётся первый сезон", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const alice = await createUser(db);
      await db.as.user(alice);
      const { rows } = await db.query("select * from public.create_group('Друзья', 'Asia/Almaty', 30, 8)");
      const group = rows[0].id;
      const members = await db.query("select role from public.group_members where group_id = $1", [group]);
      expect(members.rows).toEqual([{ role: "owner" }]);
      const season = await db.query("select number, starts_on::text, ends_on::text from public.seasons where group_id = $1", [group]);
      expect(season.rows[0]).toEqual({ number: 1, starts_on: "2026-10-09", ends_on: "2026-11-08" });
    }));

  it("неизвестный часовой пояс отклоняется", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      await db.as.user(alice);
      await expectDenied(db, "select public.create_group('X', 'Mars/Olympus')", [], "invalid_timezone");
    }));

  it("вступление по коду, лимит участников, повторное вступление", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [alice, bob, carol] = [await createUser(db), await createUser(db), await createUser(db)];
      await db.as.user(alice);
      const g = (await db.query("select id from public.create_group('Пара', 'Asia/Almaty', 30, 2)")).rows[0].id;
      const code = (await db.query("select code from public.create_invite($1)", [g])).rows[0].code as string;
      expect(code).toMatch(/^[A-Z0-9]{8}$/);

      await db.as.user(bob);
      const preview = await db.query("select group_name, member_count from public.invite_preview($1)", [code.toLowerCase()]);
      expect(preview.rows[0]).toEqual({ group_name: "Пара", member_count: 1 });
      await db.query("select public.join_group($1)", [code]);
      await expectDenied(db, "select public.join_group($1)", [code], "already_member");

      await db.as.user(carol);
      await expectDenied(db, "select public.join_group($1)", [code], "group_full");
    }));

  it("участник не может создавать инвайты; отозванный и просроченный инвайт не работает", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [alice, bob, carol] = [await createUser(db), await createUser(db), await createUser(db)];
      const g = await createGroup(db, alice, { members: [bob] });
      await db.as.user(bob);
      await expectDenied(db, "select public.create_invite($1)", [g], "admin_only");

      await db.as.user(alice);
      const inv = (await db.query("select id, code from public.create_invite($1, 1)", [g])).rows[0];
      await db.query("select public.revoke_invite($1)", [inv.id]);
      await db.as.user(carol);
      await expectDenied(db, "select public.join_group($1)", [inv.code], "invite_invalid");

      await db.as.user(alice);
      const inv2 = (await db.query("select code from public.create_invite($1, 1)", [g])).rows[0];
      await setClock(db, "2026-10-09T07:00:00Z"); // +2 часа
      await db.as.user(carol);
      await expectDenied(db, "select public.join_group($1)", [inv2.code], "invite_invalid");
    }));

  it("смена таймзоны и правил вступает в силу со следующего дня", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const alice = await createUser(db);
      const g = await createGroup(db, alice);
      await db.as.user(alice);
      await db.query(
        `select public.update_group_settings($1, p_timezone => 'Europe/Moscow',
           p_rules => '{"graceMinutes": 60}', p_scoring => '{"base": {"daily": 12}}')`,
        [g],
      );
      const before = await db.query("select timezone, rules->>'graceMinutes' as grace, pending_effective_from::text as eff from public.groups where id = $1", [g]);
      expect(before.rows[0]).toEqual({ timezone: "Asia/Almaty", grace: "120", eff: "2026-10-10" });

      await db.as.admin();
      expect((await db.query("select app_private.apply_pending_group_changes() as n")).rows[0].n).toBe(0);
      await setClock(db, "2026-10-09T20:00:00Z"); // 01:00 10 октября в Алматы
      expect((await db.query("select app_private.apply_pending_group_changes() as n")).rows[0].n).toBe(1);
      const after = await db.query(
        "select timezone, rules->>'graceMinutes' as grace, scoring_config->'base'->>'daily' as daily, scoring_config->'base'->>'weekly' as weekly from public.groups where id = $1",
        [g],
      );
      expect(after.rows[0]).toEqual({ timezone: "Europe/Moscow", grace: "60", daily: "12", weekly: "30" });
    }));

  it("сохранение без изменений не создаёт отложенных правок", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const alice = await createUser(db);
      const g = await createGroup(db, alice);
      await db.as.user(alice);
      await db.query(
        `select public.update_group_settings($1, p_name => 'Новое имя', p_timezone => 'Asia/Almaty', p_rules => '{"graceMinutes": 120}')`,
        [g],
      );
      const { rows } = await db.query("select name, pending_changes from public.groups where id = $1", [g]);
      expect(rows[0]).toEqual({ name: "Новое имя", pending_changes: null });
    }));

  it("неизвестные или выходящие за пределы настройки отклоняются", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const g = await createGroup(db, alice);
      await db.as.user(alice);
      await expectDenied(db, `select public.update_group_settings($1, p_rules => '{"hack": 1}')`, [g], "invalid_settings");
      await expectDenied(db, `select public.update_group_settings($1, p_rules => '{"graceMinutes": 10000}')`, [g], "invalid_settings");
      await expectDenied(db, `select public.update_group_settings($1, p_scoring => '{"base": {"daily": -5}}')`, [g], "invalid_settings");
    }));

  it("роли: только owner назначает, передача владения, owner не может просто уйти", () =>
    tx(async (db) => {
      const [alice, bob, carol] = [await createUser(db), await createUser(db), await createUser(db)];
      const g = await createGroup(db, alice, { members: [bob, carol] });
      await db.as.user(bob);
      await expectDenied(db, "select public.set_member_role($1, $2, 'admin')", [g, bob], "owner_only");
      await db.as.user(alice);
      await expectDenied(db, "select public.leave_group($1)", [g], "owner_must_transfer");
      await db.query("select public.set_member_role($1, $2, 'owner')", [g, bob]);
      const roles = await db.query("select user_id, role from public.group_members where group_id = $1 order by role", [g]);
      expect(Object.fromEntries(roles.rows.map((r) => [r.user_id, r.role]))).toEqual({ [alice]: "admin", [bob]: "owner", [carol]: "member" });
      // admin не может удалить owner'а
      await expectDenied(db, "select public.remove_member($1, $2)", [g, bob], "owner_only");
      await db.query("select public.remove_member($1, $2)", [g, carol]);
    }));
});

describe("привычки и одобрение", () => {
  it("в группе из одного человека привычка одобряется сразу", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const alice = await createUser(db);
      const g = await createGroup(db, alice);
      const h = await propose(db, alice, g);
      expect(h).toMatchObject({ status: "active" });
      expect(String(h.active_from)).toContain("2026");
    }));

  it("большинство других участников одобряет; за свою голосовать нельзя", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [a, b, c, d] = [await createUser(db), await createUser(db), await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b, c, d] });
      const h = await propose(db, a, g);
      expect(h.status).toBe("proposed");
      await db.as.user(a);
      await expectDenied(db, "select public.vote_habit($1, 'approve')", [h.id], "cannot_vote_own");
      await db.as.user(b);
      expect((await db.query("select status from public.vote_habit($1, 'approve')", [h.id])).rows[0].status).toBe("proposed");
      await db.as.user(c);
      const res = await db.query("select status, active_from::text from public.vote_habit($1, 'approve')", [h.id]);
      // 2 из 3 — большинство. Пятница → ежедневная активна с сегодня.
      expect(res.rows[0]).toEqual({ status: "active", active_from: "2026-10-09" });
    }));

  it("недельная привычка, одобренная в пятницу, стартует с понедельника", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      const h = await propose(db, a, g, { frequency: "weekly", target: 3 });
      await db.as.user(b);
      const res = await db.query("select status, active_from::text from public.vote_habit($1, 'approve')", [h.id]);
      expect(res.rows[0]).toEqual({ status: "active", active_from: "2026-10-12" });
    }));

  it("просьба сделать измеримой требует комментарий; правка сбрасывает голоса", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b, c] });
      const h = await propose(db, a, g);
      await db.as.user(b);
      await expectDenied(db, "select public.vote_habit($1, 'request_changes')", [h.id], "comment_required");
      await db.query("select public.vote_habit($1, 'request_changes', 'Сколько именно?')", [h.id]);
      await db.as.user(a);
      await db.query(
        "select public.edit_proposed_habit($1, 'Отжимания 30', '30 отжиманий за один подход, видео/фото', 'daily', 1, 'photo', 'hard')",
        [h.id],
      );
      await db.as.admin();
      expect((await db.query("select 1 from public.habit_votes where habit_id = $1", [h.id])).rows).toHaveLength(0);
    }));

  it("большинство против — привычка отклонена", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b, c] });
      const h = await propose(db, a, g);
      for (const u of [b, c]) {
        await db.as.user(u);
        await db.query("select public.vote_habit($1, 'reject', 'Слишком легко')", [h.id]);
      }
      await db.as.admin();
      expect((await db.query("select status from public.habits where id = $1", [h.id])).rows[0].status).toBe("rejected");
    }));

  it("режим «N голосов»", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const users = [];
      for (let i = 0; i < 5; i++) users.push(await createUser(db));
      const [a, ...rest] = users as [string, ...string[]];
      const g = await createGroup(db, a, { members: rest });
      await db.query(`update public.groups set rules = rules || '{"habitApproval": "count", "habitApprovalVotes": 1}' where id = $1`, [g]);
      const h = await propose(db, a, g);
      await db.as.user(rest[0]!);
      expect((await db.query("select status from public.vote_habit($1, 'approve')", [h.id])).rows[0].status).toBe("active");
    }));

  it("лимит активных привычек", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const a = await createUser(db);
      const g = await createGroup(db, a);
      await db.query(`update public.groups set rules = rules || '{"maxActiveHabits": 2}' where id = $1`, [g]);
      await propose(db, a, g);
      await propose(db, a, g);
      await db.as.user(a);
      await expectDenied(
        db,
        `select public.propose_habit($1, 'Третья', 'Описание третьей привычки', 'daily', 1, 'honor', 'easy')`,
        [g],
        "habit_limit_reached",
      );
    }));

  it("удаление активной привычки действует только со следующего периода", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const a = await createUser(db);
      const g = await createGroup(db, a);
      const daily = await propose(db, a, g);
      await setClock(db, MONDAY);
      const weekly = await propose(db, a, g, { frequency: "weekly", target: 2 });
      await db.as.user(a);
      const d = await db.query("select status, active_until::text from public.archive_habit($1)", [daily.id]);
      expect(d.rows[0]).toEqual({ status: "active", active_until: "2026-10-13" });
      const w = await db.query("select active_until::text from public.archive_habit($1)", [weekly.id]);
      expect(w.rows[0]).toEqual({ active_until: "2026-10-19" });
      // Сегодняшний период ещё действует: отметка требует фото, а не «привычка неактивна».
      const err = await attempt(db, "select public.create_checkin($1)", [daily.id]);
      expect(err?.message).toBe("proof_required");
    }));

  it("изменение привычки = замена со следующего периода", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      const old = await propose(db, a, g);
      await db.as.user(b);
      await db.query("select public.vote_habit($1, 'approve')", [old.id]);
      const next = await propose(db, a, g, { replaces: old.id, title: "Отжимания 50" });
      expect(next.status).toBe("proposed");
      await db.as.user(a);
      await expectDenied(
        db,
        `select public.propose_habit($1, 'Ещё', 'Ещё одно изменение привычки', 'daily', 1, 'photo', 'medium', $2)`,
        [g, old.id],
        "change_already_proposed",
      );
      await db.as.user(b);
      const res = await db.query("select status, active_from::text from public.vote_habit($1, 'approve')", [next.id]);
      expect(res.rows[0]).toEqual({ status: "active", active_from: "2026-10-10" });
      await db.as.admin();
      expect((await db.query("select active_until::text from public.habits where id = $1", [old.id])).rows[0].active_until).toBe(
        "2026-10-10",
      );
    }));

  it("выход участника архивирует его привычки, история остаётся", () =>
    tx(async (db) => {
      await setClock(db, FRIDAY);
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      const h = await propose(db, b, g);
      await db.as.user(b);
      await db.query("select public.leave_group($1)", [g]);
      await db.as.admin();
      expect((await db.query("select status from public.habits where id = $1", [h.id])).rows[0].status).toBe("archived");
    }));
});
