import { describe, expect, it } from "vitest";
import { attempt, createGroup, createHabit, createUser, setClock, tx, type Db } from "./helpers";

const at = (date: string, time = "05:00") => `2026-${date}T${time}:00Z`;

async function outbox(db: Db) {
  await db.as.admin();
  return (await db.query("select user_id, kind, payload from public.notification_outbox order by id")).rows;
}

describe("уведомления", () => {
  it("вечернее напоминание: после 20:00, только если не отмечено, один раз в день", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      await createHabit(db, g, a, { activeFrom: "2026-10-05" });
      const hb = await createHabit(db, g, b, { activeFrom: "2026-10-05" });
      await db.as.user(b);
      await db.query("select public.create_checkin($1)", [hb]);

      await setClock(db, at("10-05", "14:00")); // 19:00 Алматы — рано
      await db.query("select app_private.enqueue_reminders()");
      expect(await outbox(db)).toHaveLength(0);
      await setClock(db, at("10-05", "15:30")); // 20:30
      await db.query("select app_private.enqueue_reminders()");
      await db.query("select app_private.enqueue_reminders()");
      const rows = await outbox(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: a, kind: "evening_reminder", payload: { open_habits: 1 } });
    }));

  it("напоминания можно выключить", () =>
    tx(async (db) => {
      await setClock(db, at("10-05", "16:00"));
      const a = await createUser(db);
      const g = await createGroup(db, a);
      await createHabit(db, g, a, { activeFrom: "2026-10-05" });
      await db.as.user(a);
      await db.query("update public.notification_prefs set evening_reminder = false");
      await db.as.admin();
      await db.query("select app_private.enqueue_reminders()");
      expect(await outbox(db)).toHaveLength(0);
    }));

  it("автор узнаёт, что его отметку оспорили", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b, c] });
      const h = await createHabit(db, g, a, { activeFrom: "2026-10-05" });
      await db.as.user(a);
      const id = (await db.query("select id from public.create_checkin($1)", [h])).rows[0].id;
      await db.as.user(b);
      await db.query("select public.vote_checkin($1, 'dispute', 'не верю')", [id]);
      await db.query("select public.vote_checkin($1, 'dispute', 'всё ещё не верю')", [id]);
      const rows = await outbox(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: a, kind: "checkin_disputed", payload: { comment: "не верю" } });
    }));

  it("итоги недели в понедельник после 9:00 с местом в группе", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      await db.query(
        `insert into public.points_ledger (group_id, user_id, event_type, amount, reason, idempotency_key, created_at)
         values ($1, $2, 'checkin', 10, 'x', 'k1', '2026-10-07T05:00:00Z')`,
        [g, b],
      );
      await setClock(db, at("10-12", "03:00")); // пн 08:00 — рано
      await db.query("select app_private.enqueue_weekly_digests()");
      expect(await outbox(db)).toHaveLength(0);
      await setClock(db, at("10-12", "05:00"));
      await db.query("select app_private.enqueue_weekly_digests()");
      await db.query("select app_private.enqueue_weekly_digests()");
      const rows = await outbox(db);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.user_id === b)?.payload).toMatchObject({ points: 10, rank: 1, members: 2 });
    }));

  it("очередь недоступна клиенту, забирать её может только сервер", () =>
    tx(async (db) => {
      const a = await createUser(db);
      await db.as.user(a);
      expect((await attempt(db, "select * from public.notification_outbox"))?.code).toBe("42501");
      expect((await attempt(db, "select * from public.claim_notifications()"))?.code).toBe("42501");
    }));

  it("claim не выдаёт одно уведомление дважды", () =>
    tx(async (db) => {
      await setClock(db, at("10-05", "16:00"));
      const a = await createUser(db);
      const g = await createGroup(db, a);
      await createHabit(db, g, a, { activeFrom: "2026-10-05" });
      await db.query("select app_private.enqueue_reminders()");
      await db.as.service();
      const first = (await db.query("select id, email, wants from public.claim_notifications()")).rows;
      expect(first).toHaveLength(1);
      expect(first[0].wants).toBe(true);
      expect((await db.query("select id from public.claim_notifications()")).rows).toHaveLength(0);
      await db.query("select public.complete_notification($1)", [first[0].id]);
    }));
});

describe("итоги сезона", () => {
  it("таблица, лучшие стрики и честные судьи", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      await db.as.user(a);
      const g = (await db.query("select id from public.create_group('S', 'Asia/Almaty', 7)")).rows[0].id;
      await db.as.admin();
      await db.query("insert into public.group_members (group_id, user_id) values ($1, $2)", [g, b]);
      const h = await createHabit(db, g, b, { activeFrom: "2026-10-05" });
      for (let d = 5; d <= 7; d++) {
        await setClock(db, at(`10-0${d}`));
        await db.as.user(b);
        const id = (await db.query("select id from public.create_checkin($1)", [h])).rows[0].id;
        await db.as.user(a);
        await db.query("select public.vote_checkin($1, 'confirm')", [id]);
      }
      await setClock(db, at("10-12", "21:00"));
      await db.as.admin();
      await db.query("select app_private.tick()");
      const season = (await db.query("select id from public.seasons where group_id = $1 and number = 1", [g])).rows[0].id;
      await db.as.user(a);
      const r = (await db.query("select public.season_results($1) as r", [season])).rows[0].r;
      expect(r.season.status).toBe("closed");
      expect(r.standings[0].user_id).toBe(b);
      expect(r.best_streaks[0]).toMatchObject({ user_id: b, streak: 3 });
      expect(r.judges[0]).toMatchObject({ user_id: a, correct: 3 });
      await db.as.admin();
      expect((await db.query("select count(*)::int as n from public.notification_outbox where kind = 'season_results'")).rows[0].n).toBe(2);
    }));
});
