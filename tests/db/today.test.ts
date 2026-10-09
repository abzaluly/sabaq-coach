import { describe, expect, it } from "vitest";
import { createGroup, createHabit, createUser, setClock, tx } from "./helpers";

describe("my_today", () => {
  it("показывает прогресс периода и возможность отметить вчера в grace-окно", () =>
    tx(async (db) => {
      await setClock(db, "2026-10-08T05:00:00Z"); // чт 10:00 Алматы
      const a = await createUser(db);
      const g = await createGroup(db, a);
      const daily = await createHabit(db, g, a);
      const weekly = await createHabit(db, g, a, { frequency: "weekly", target: 3 });
      await db.as.user(a);
      await db.query("select public.create_checkin($1)", [weekly]);

      let { rows } = await db.query("select habit_id, done_count, checked_today, can_previous_day from public.my_today()");
      const byId = Object.fromEntries(rows.map((r) => [r.habit_id, r]));
      expect(byId[daily]).toMatchObject({ done_count: 0, checked_today: false, can_previous_day: false });
      expect(byId[weekly]).toMatchObject({ done_count: 1, checked_today: true });

      await setClock(db, "2026-10-08T20:00:00Z"); // пт 01:00 — grace
      await db.as.user(a);
      ({ rows } = await db.query("select habit_id, checked_today, can_previous_day from public.my_today()"));
      const after = Object.fromEntries(rows.map((r) => [r.habit_id, r]));
      expect(after[daily]).toMatchObject({ checked_today: false, can_previous_day: true });
      // вчера (чт) недельная уже отмечена
      expect(after[weekly]).toMatchObject({ checked_today: false, can_previous_day: false });
    }));

  it("не показывает чужие привычки и привычки до active_from", () =>
    tx(async (db) => {
      await setClock(db, "2026-10-08T05:00:00Z");
      const [a, b] = [await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b] });
      await createHabit(db, g, b);
      await createHabit(db, g, a, { activeFrom: "2026-10-12" });
      await db.as.user(a);
      expect((await db.query("select * from public.my_today()")).rows).toHaveLength(0);
    }));
});
