import { describe, expect, it } from "vitest";
import { attempt, createGroup, createHabit, createUser, expectDenied, setClock, tx } from "./helpers";

// 2026-10-09 10:00 в Алматы (UTC+5) = 05:00 UTC
const ALMATY_MORNING = "2026-10-09T05:00:00Z";

describe("points_ledger: очки пишет только сервер", () => {
  it("участник не может начислить себе очки", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      await db.as.user(alice);
      await expectDenied(
        db,
        `insert into public.points_ledger (group_id, user_id, event_type, amount, reason, idempotency_key)
         values ($1, $2, 'adjustment', 1000, 'free points', 'x')`,
        [group, alice],
      );
    }));

  it("участник не может изменить или удалить запись журнала", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      await db.query(
        `insert into public.points_ledger (group_id, user_id, event_type, amount, reason, idempotency_key)
         values ($1, $2, 'miss_penalty', -5, 'пропуск', 'k1')`,
        [group, alice],
      );
      await db.as.user(alice);
      await expectDenied(db, "update public.points_ledger set amount = 500 where user_id = $1", [alice]);
      await expectDenied(db, "delete from public.points_ledger where user_id = $1", [alice]);
    }));

  it("журнал append-only даже для суперпользователя", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      await db.query(
        `insert into public.points_ledger (group_id, user_id, event_type, amount, reason, idempotency_key)
         values ($1, $2, 'checkin', 10, 'отметка', 'k2')`,
        [group, alice],
      );
      const upd = await attempt(db, "update public.points_ledger set amount = 99");
      expect(upd?.message).toBe("points_ledger is append-only");
      const del = await attempt(db, "delete from public.points_ledger");
      expect(del?.message).toBe("points_ledger is append-only");
    }));

  it("повторная запись с тем же ключом идемпотентности отклоняется", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      const sql = `insert into public.points_ledger (group_id, user_id, event_type, amount, reason, idempotency_key)
                   values ($1, $2, 'checkin', 10, 'отметка', 'same-key')`;
      await db.query(sql, [group, alice]);
      const err = await attempt(db, sql, [group, alice]);
      expect(err?.code).toBe("23505");
    }));

  it("участник видит журнал всей группы (прозрачность)", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const bob = await createUser(db);
      const group = await createGroup(db, alice, { members: [bob] });
      await db.query(
        `insert into public.points_ledger (group_id, user_id, event_type, amount, reason, idempotency_key)
         values ($1, $2, 'checkin', 10, 'отметка', 'k3')`,
        [group, alice],
      );
      await db.as.user(bob);
      const { rows } = await db.query("select amount from public.points_ledger where user_id = $1", [alice]);
      expect(rows).toHaveLength(1);
    }));
});

describe("голосование за отметки", () => {
  async function setup(db: Parameters<Parameters<typeof tx>[0]>[0]) {
    await setClock(db, ALMATY_MORNING);
    const alice = await createUser(db);
    const bob = await createUser(db);
    const group = await createGroup(db, alice, { members: [bob] });
    const habit = await createHabit(db, group, alice);
    await db.as.user(alice);
    const { rows } = await db.query<{ id: string }>("select id from public.create_checkin($1)", [habit]);
    return { alice, bob, group, checkin: rows[0]!.id };
  }

  it("нельзя голосовать за свою отметку", () =>
    tx(async (db) => {
      const { alice, checkin } = await setup(db);
      await db.as.user(alice);
      await expectDenied(db, "select public.vote_checkin($1, 'confirm')", [checkin], "cannot_vote_own");
    }));

  it("нельзя записать голос напрямую в таблицу, минуя сервер", () =>
    tx(async (db) => {
      const { alice, group, checkin } = await setup(db);
      await db.as.user(alice);
      await expectDenied(
        db,
        "insert into public.checkin_votes (checkin_id, voter_id, group_id, vote, weight) values ($1, $2, $3, 'confirm', 1)",
        [checkin, alice, group],
      );
    }));

  it("другой участник может подтвердить, оспорить — только с комментарием", () =>
    tx(async (db) => {
      const { bob, checkin } = await setup(db);
      await db.as.user(bob);
      await expectDenied(db, "select public.vote_checkin($1, 'dispute')", [checkin], "comment_required");
      const { rows } = await db.query("select vote, weight from public.vote_checkin($1, 'confirm')", [checkin]);
      expect(rows[0]).toMatchObject({ vote: "confirm", weight: "1.000" });
    }));

  it("чужак не может голосовать в группе, где не состоит", () =>
    tx(async (db) => {
      const { checkin } = await setup(db);
      const mallory = await createUser(db);
      await db.as.user(mallory);
      await expectDenied(db, "select public.vote_checkin($1, 'confirm')", [checkin], "checkin_not_found");
    }));

  it("вес подтверждений одному и тому же автору убывает", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const bob = await createUser(db);
      const group = await createGroup(db, alice, { members: [bob] });
      const weights: string[] = [];
      for (let i = 0; i < 3; i++) {
        const habit = await createHabit(db, group, alice);
        await db.as.user(alice);
        const { rows } = await db.query<{ id: string }>("select id from public.create_checkin($1)", [habit]);
        await db.as.user(bob);
        const vote = await db.query<{ weight: string }>("select weight from public.vote_checkin($1, 'confirm')", [
          rows[0]!.id,
        ]);
        weights.push(vote.rows[0]!.weight);
      }
      expect(weights).toEqual(["1.000", "0.500", "0.333"]);
    }));

  it("участник не может сам поменять статус отметки", () =>
    tx(async (db) => {
      const { alice, bob, checkin } = await setup(db);
      for (const who of [alice, bob]) {
        await db.as.user(who);
        await expectDenied(db, "update public.checkins set status = 'approved' where id = $1", [checkin]);
      }
    }));
});

describe("отметки", () => {
  it("нельзя отметить чужую привычку", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const bob = await createUser(db);
      const group = await createGroup(db, alice, { members: [bob] });
      const habit = await createHabit(db, group, alice);
      await db.as.user(bob);
      await expectDenied(db, "select public.create_checkin($1)", [habit], "not_your_habit");
      await expectDenied(
        db,
        `insert into public.checkins (habit_id, group_id, user_id, period_start, local_date, slot, review_until)
         values ($1, $2, $3, '2026-10-09', '2026-10-09', 1, now())`,
        [habit, group, bob],
      );
    }));

  it("нельзя отметить прошлый день после grace-периода", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING); // 10:00 по Алматы, grace 2 часа давно истёк
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      const habit = await createHabit(db, group, alice);
      await db.as.user(alice);
      await expectDenied(db, "select public.create_checkin($1, null, null, true)", [habit], "grace_expired");
    }));

  it("вчерашний день можно отметить в grace-окно после полуночи", () =>
    tx(async (db) => {
      await setClock(db, "2026-10-08T20:30:00Z"); // 01:30 9 октября по Алматы
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      const habit = await createHabit(db, group, alice);
      await db.as.user(alice);
      const { rows } = await db.query("select local_date::text from public.create_checkin($1, null, null, true)", [
        habit,
      ]);
      expect(rows[0]).toMatchObject({ local_date: "2026-10-08" });
    }));

  it("нельзя подделать дату или время отметки", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      const habit = await createHabit(db, group, alice);
      await db.as.user(alice);
      const { rows } = await db.query<{ id: string; created_at: Date }>(
        "select id, created_at from public.create_checkin($1)",
        [habit],
      );
      expect(rows[0]!.created_at.toISOString()).toBe("2026-10-09T05:00:00.000Z");
      await expectDenied(db, "update public.checkins set local_date = '2026-10-01' where id = $1", [rows[0]!.id]);
      await expectDenied(db, "update public.checkins set created_at = now() - interval '3 days' where id = $1", [
        rows[0]!.id,
      ]);
    }));

  it("день определяется по часовому поясу группы", () =>
    tx(async (db) => {
      await setClock(db, "2026-10-08T21:00:00Z"); // 02:00 9 октября в Алматы, 22:00 8-го в Лондоне
      const alice = await createUser(db);
      const almaty = await createGroup(db, alice, { timezone: "Asia/Almaty" });
      const london = await createGroup(db, alice, { timezone: "Europe/London" });
      const h1 = await createHabit(db, almaty, alice);
      const h2 = await createHabit(db, london, alice);
      await db.as.user(alice);
      const a = await db.query("select local_date::text from public.create_checkin($1)", [h1]);
      const l = await db.query("select local_date::text from public.create_checkin($1)", [h2]);
      expect(a.rows[0]).toMatchObject({ local_date: "2026-10-09" });
      expect(l.rows[0]).toMatchObject({ local_date: "2026-10-08" });
    }));

  it("одна отметка на слот: повтор в тот же день отклоняется", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      const daily = await createHabit(db, group, alice);
      const weekly = await createHabit(db, group, alice, { frequency: "weekly", target: 3 });
      await db.as.user(alice);
      await db.query("select public.create_checkin($1)", [daily]);
      await expectDenied(db, "select public.create_checkin($1)", [daily], "period_complete");
      await db.query("select public.create_checkin($1)", [weekly]);
      await expectDenied(db, "select public.create_checkin($1)", [weekly], "already_checked_in");
    }));

  it("фото-привычка требует пруф, загруженный сервером", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      const habit = await createHabit(db, group, alice, { proof: "photo" });
      await db.as.user(alice);
      await expectDenied(db, "select public.create_checkin($1)", [habit], "proof_required");
      // Клиент не может сам зарегистрировать пруф.
      await expectDenied(db, "select public.register_proof($1, $2, 'x.jpg', 'ffffffffffffffff', null)", [
        alice,
        group,
      ]);
      await db.as.service();
      const { rows } = await db.query<{ id: string }>(
        "select id from public.register_proof($1, $2, 'p/1.jpg', '0123456789abcdef', null)",
        [alice, group],
      );
      await db.as.user(alice);
      const res = await db.query("select status from public.create_checkin($1, null, $2)", [habit, rows[0]!.id]);
      expect(res.rows[0]).toMatchObject({ status: "pending" });
    }));

  it("повторная загрузка того же изображения помечается", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      await db.as.service();
      await db.query("select public.register_proof($1, $2, 'p/a.jpg', '0123456789abcdef', null)", [alice, group]);
      const { rows } = await db.query<{ flags: string[] }>(
        "select flags from public.register_proof($1, $2, 'p/b.jpg', '0123456789abcdef', '2026-09-01T00:00:00Z')",
        [alice, group],
      );
      expect(rows[0]!.flags).toEqual(["duplicate_image", "old_photo"]);
    }));

  it("слишком частые отметки блокируются и попадают в аудит", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const group = await createGroup(db, alice);
      await db.query("update public.groups set rules = rules || '{\"checkinsPerMinute\": 2}' where id = $1", [group]);
      const habits = [];
      for (let i = 0; i < 3; i++) habits.push(await createHabit(db, group, alice));
      await db.as.user(alice);
      await db.query("select public.create_checkin($1)", [habits[0]]);
      await db.query("select public.create_checkin($1)", [habits[1]]);
      // NULL вместо исключения, чтобы запись в аудит не откатилась.
      const blocked = await db.query("select id from public.create_checkin($1)", [habits[2]]);
      expect(blocked.rows[0]).toEqual({ id: null });
      await db.as.admin();
      expect((await db.query("select 1 from public.checkins where habit_id = $1", [habits[2]])).rows).toHaveLength(0);
      const { rows } = await db.query("select kind from public.audit_log where user_id = $1", [alice]);
      expect(rows).toEqual([{ kind: "rate_limited_checkin" }]);
    }));
});

describe("видимость групп", () => {
  it("чужак не видит группу, её участников, привычки, отметки и журнал", () =>
    tx(async (db) => {
      await setClock(db, ALMATY_MORNING);
      const alice = await createUser(db);
      const mallory = await createUser(db);
      const group = await createGroup(db, alice);
      const habit = await createHabit(db, group, alice);
      await db.as.user(alice);
      await db.query("select public.create_checkin($1)", [habit]);
      await db.as.user(mallory);
      for (const table of ["groups", "group_members", "habits", "checkins", "points_ledger", "seasons", "periods"]) {
        const { rows } = await db.query(`select 1 from public.${table}`);
        expect(rows, table).toHaveLength(0);
      }
      const { rows } = await db.query("select id from public.profiles");
      expect(rows).toEqual([{ id: mallory }]);
    }));

  it("анонимный пользователь не видит ничего, кроме каталогов", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      await createGroup(db, alice);
      await db.as.anon();
      await expectDenied(db, "select * from public.groups");
      await expectDenied(db, "select * from public.profiles");
      await expectDenied(db, "select public.create_checkin(gen_random_uuid())");
    }));

  it("участник не может добавить себя в чужую группу или повысить роль", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const bob = await createUser(db);
      const mallory = await createUser(db);
      const group = await createGroup(db, alice, { members: [bob] });
      await db.as.user(mallory);
      await expectDenied(db, "insert into public.group_members (group_id, user_id) values ($1, $2)", [group, mallory]);
      await db.as.user(bob);
      await expectDenied(db, "update public.group_members set role = 'owner' where user_id = $1", [bob]);
    }));

  it("инвайты видят только owner/admin", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const bob = await createUser(db);
      const group = await createGroup(db, alice, { members: [bob] });
      await db.query("insert into public.invites (group_id, code, created_by) values ($1, 'ABCD1234', $2)", [
        group,
        alice,
      ]);
      await db.as.user(bob);
      expect((await db.query("select 1 from public.invites")).rows).toHaveLength(0);
      await db.as.user(alice);
      expect((await db.query("select 1 from public.invites")).rows).toHaveLength(1);
    }));
});

describe("профили и онбординг", () => {
  it("онбординг заполняет профиль, никнейм уникален без учёта регистра", () =>
    tx(async (db) => {
      await createUser(db, "Aigerim");
      await db.as.admin();
      const { rows } = await db.query<{ id: string }>("insert into auth.users (id, email) values (gen_random_uuid(), 'new@example.test') returning id");
      const me = rows[0]!.id;
      await db.as.user(me);
      expect((await db.query("select public.nickname_available('aigerim') as ok")).rows[0]).toEqual({ ok: false });
      await expectDenied(db, "select public.complete_onboarding('Айгерим', 'AIGERIM', 'seed1')", [], "nickname_taken");
      await expectDenied(db, "select public.complete_onboarding('Айгерим', 'no spaces!', 'seed1')", [], "invalid_nickname");
      const res = await db.query("select nickname::text, onboarded_at is not null as done from public.complete_onboarding('Айгерим', 'aika_99', 'seed1')");
      expect(res.rows[0]).toEqual({ nickname: "aika_99", done: true });
    }));

  it("нельзя изменить чужой профиль напрямую", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const bob = await createUser(db);
      await createGroup(db, alice, { members: [bob] });
      await db.as.user(bob);
      await expectDenied(db, "update public.profiles set display_name = 'hacked' where id = $1", [alice]);
    }));

  it("настройки уведомлений — только свои", () =>
    tx(async (db) => {
      const alice = await createUser(db);
      const bob = await createUser(db);
      await db.as.user(bob);
      const res = await db.query("update public.notification_prefs set weekly_digest = false where user_id = $1", [alice]);
      expect(res.rowCount).toBe(0);
      const own = await db.query("update public.notification_prefs set weekly_digest = false where user_id = $1", [bob]);
      expect(own.rowCount).toBe(1);
    }));
});
