import { describe, expect, it } from "vitest";
import { createGroup, createHabit, createUser, expectDenied, setClock, tx, type Db } from "./helpers";

const at = (date: string, time = "05:00") => `2026-${date}T${time}:00Z`;

async function honorCheckin(db: Db, user: string, habit: string, when: string) {
  await setClock(db, when);
  await db.as.user(user);
  const id = (await db.query("select id from public.create_checkin($1)", [habit])).rows[0].id as string;
  await db.as.admin();
  return id;
}

async function achievements(db: Db, user: string) {
  await db.as.admin();
  return (await db.query("select achievement_code from public.user_achievements where user_id = $1 order by 1", [user])).rows.map(
    (r) => r.achievement_code,
  );
}

describe("достижения", () => {
  it("7 дней стрика и полная неделя (пн–вс)", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const u = await createUser(db);
      const g = await createGroup(db, u);
      const h = await createHabit(db, g, u, { activeFrom: "2026-10-05" });
      for (let d = 5; d <= 11; d++) await honorCheckin(db, u, h, at(`10-${String(d).padStart(2, "0")}`));
      await setClock(db, at("10-12", "21:00"));
      await db.query("select app_private.tick()");
      expect(await achievements(db, u)).toEqual(["first_full_week", "streak_7"]);
    }));

  it("честный судья: 10 голосов совпали с решением, есть верный спор", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
      const g = await createGroup(db, a, { members: [b, c] });
      await db.query(`update public.groups set rules = rules || '{"confirmationsToApprove": 1, "collusionWindowDays": 1}'`);
      for (let i = 0; i < 10; i++) {
        // Каждая отметка — в свой день: подтверждения старше окна сговора (1 день) весят полностью.
        const day = at(`10-${String(5 + i).padStart(2, "0")}`);
        const h = await createHabit(db, g, a, { activeFrom: "2026-10-05" });
        const id = await honorCheckin(db, a, h, day);
        await db.as.user(b);
        if (i === 0) {
          await db.query("select public.vote_checkin($1, 'dispute', 'не то')", [id]);
          await db.as.user(c);
          await db.query("select public.vote_checkin($1, 'dispute', 'согласен')", [id]);
        } else {
          await db.query("select public.vote_checkin($1, 'confirm')", [id]);
        }
      }
      expect(await achievements(db, b)).toContain("honest_judge");
      expect(await achievements(db, c)).not.toContain("honest_judge");
    }));

  it("победитель сезона", () =>
    tx(async (db) => {
      await setClock(db, at("10-05"));
      const [a, b] = [await createUser(db), await createUser(db)];
      await db.as.user(a);
      const g = (await db.query("select id from public.create_group('S', 'Asia/Almaty', 7)")).rows[0].id;
      await db.as.admin();
      await db.query("insert into public.group_members (group_id, user_id) values ($1, $2)", [g, b]);
      const hb = await createHabit(db, g, b, { activeFrom: "2026-10-05" });
      for (let d = 5; d <= 11; d++) await honorCheckin(db, b, hb, at(`10-${String(d).padStart(2, "0")}`));
      await setClock(db, at("10-12", "21:00"));
      await db.query("select app_private.tick()");
      expect(await achievements(db, b)).toContain("season_winner");
      expect(await achievements(db, a)).toEqual([]);
    }));
});

describe("косметика", () => {
  it("надеть можно только открытую", () =>
    tx(async (db) => {
      const u = await createUser(db);
      const g = await createGroup(db, u);
      await db.as.user(u);
      await expectDenied(db, "select public.equip_cosmetic('frame', 'frame_ember')", [], "cosmetic_locked");
      await db.as.admin();
      await db.query("select app_private.award($1, $2, 'streak_7')", [u, g]);
      await db.as.user(u);
      await db.query("select public.equip_cosmetic('frame', 'frame_ember')");
      await expectDenied(db, "select public.equip_cosmetic('background', 'frame_ember')", [], "cosmetic_locked");
      expect((await db.query("select cosmetic_code from public.equipped_cosmetics")).rows).toEqual([{ cosmetic_code: "frame_ember" }]);
      await db.query("select public.equip_cosmetic('frame', null)");
      expect((await db.query("select 1 from public.equipped_cosmetics")).rows).toHaveLength(0);
    }));

  it("достижения нельзя выдать себе напрямую", () =>
    tx(async (db) => {
      const u = await createUser(db);
      const g = await createGroup(db, u);
      await db.as.user(u);
      await expectDenied(db, "insert into public.user_achievements (user_id, group_id, achievement_code) values ($1, $2, 'streak_100')", [u, g]);
      await expectDenied(db, "insert into public.equipped_cosmetics (user_id, kind, cosmetic_code) values ($1, 'frame', 'frame_gold')", [u]);
    }));
});
