import { describe, expect, it } from "vitest";
import { attempt, createGroup, createHabit, createUser, expectDenied, setClock, tx, type Db } from "./helpers";

const T0 = "2026-10-09T05:00:00Z"; // 10:00 Алматы

async function world(db: Db, members = 4) {
  await setClock(db, T0);
  const users: string[] = [];
  for (let i = 0; i < members; i++) users.push(await createUser(db));
  const [author, ...others] = users as [string, ...string[]];
  const group = await createGroup(db, author, { members: others });
  const habit = await createHabit(db, group, author);
  await db.as.user(author);
  const { rows } = await db.query<{ id: string }>("select id from public.create_checkin($1)", [habit]);
  await db.as.admin();
  return { author, others, group, habit, checkin: rows[0]!.id };
}

async function status(db: Db, id: string) {
  await db.as.admin();
  const { rows } = await db.query("select status, decision_reason from public.checkins where id = $1", [id]);
  return rows[0] as { status: string; decision_reason: string | null };
}

async function vote(db: Db, user: string, checkin: string, kind: "confirm" | "dispute") {
  await db.as.user(user);
  await db.query("select public.vote_checkin($1, $2, $3)", [checkin, kind, kind === "dispute" ? "Это старое фото" : null]);
}

describe("решение по отметке", () => {
  it("без голосов отметка засчитывается после окна проверки", () =>
    tx(async (db) => {
      const { checkin } = await world(db);
      await db.as.admin();
      expect((await db.query("select app_private.decide_due_checkins() as n")).rows[0].n).toBe(0);
      await setClock(db, "2026-10-10T05:00:00Z");
      expect((await db.query("select app_private.decide_due_checkins() as n")).rows[0].n).toBe(1);
      expect(await status(db, checkin)).toEqual({ status: "approved", decision_reason: "review_window_passed" });
    }));

  it("досрочное одобрение после N подтверждений", () =>
    tx(async (db) => {
      const { others, checkin } = await world(db);
      await db.query(`update public.groups set rules = rules || '{"confirmationsToApprove": 2}'`);
      await vote(db, others[0]!, checkin, "confirm");
      expect((await status(db, checkin)).status).toBe("pending");
      await vote(db, others[1]!, checkin, "confirm");
      expect(await status(db, checkin)).toEqual({ status: "approved", decision_reason: "confirmed" });
      await db.as.user(others[2]!);
      await expectDenied(db, "select public.vote_checkin($1, 'dispute', 'поздно')", [checkin], "review_closed");
    }));

  it("спор блокирует досрочное одобрение, итог — по весам в конце окна", () =>
    tx(async (db) => {
      const { others, checkin } = await world(db, 5);
      await db.query(`update public.groups set rules = rules || '{"confirmationsToApprove": 2}'`);
      await vote(db, others[0]!, checkin, "dispute");
      await vote(db, others[1]!, checkin, "confirm");
      await vote(db, others[2]!, checkin, "confirm");
      expect((await status(db, checkin)).status).toBe("pending");
      await setClock(db, "2026-10-10T06:00:00Z");
      await db.query("select app_private.decide_due_checkins()");
      expect(await status(db, checkin)).toEqual({ status: "approved", decision_reason: "confirmed" });
    }));

  it("большинство проголосовавших против — отклонено в конце окна", () =>
    tx(async (db) => {
      const { others, checkin } = await world(db, 5);
      await vote(db, others[0]!, checkin, "dispute");
      await vote(db, others[1]!, checkin, "confirm");
      await setClock(db, "2026-10-10T06:00:00Z");
      await db.query("select app_private.decide_due_checkins()");
      // 1 против (вес 1) vs 1 за (вес 1) — ничья в пользу автора
      expect((await status(db, checkin)).status).toBe("approved");
    }));

  it("больше половины группы против — отклонено сразу", () =>
    tx(async (db) => {
      const { others, checkin } = await world(db, 4); // 3 потенциальных судьи
      await vote(db, others[0]!, checkin, "dispute");
      expect((await status(db, checkin)).status).toBe("pending");
      await vote(db, others[1]!, checkin, "dispute");
      expect(await status(db, checkin)).toEqual({ status: "rejected", decision_reason: "majority_disputed" });
    }));

  it("подтверждения «своего» судьи весят меньше, чем спор", () =>
    tx(async (db) => {
      const { author, others, group, checkin } = await world(db, 5);
      // Судья уже 3 раза подтверждал этого автора → вес 0.25
      for (let i = 0; i < 3; i++) {
        const h = await createHabit(db, group, author);
        await db.as.user(author);
        const c = (await db.query("select id from public.create_checkin($1)", [h])).rows[0].id;
        await vote(db, others[0]!, c, "confirm");
      }
      await vote(db, others[0]!, checkin, "confirm");
      await vote(db, others[1]!, checkin, "dispute");
      await setClock(db, "2026-10-10T06:00:00Z");
      await db.query("select app_private.decide_checkin($1)", [checkin]);
      expect(await status(db, checkin)).toEqual({ status: "rejected", decision_reason: "disputed" });
    }));
});

describe("модерация", () => {
  it("админ может отклонить даже одобренную отметку; свою — нельзя; участник — нельзя", () =>
    tx(async (db) => {
      const { author, others, group, checkin } = await world(db);
      await db.query("update public.group_members set role = 'admin' where group_id = $1 and user_id = $2", [group, others[0]]);
      await setClock(db, "2026-10-10T06:00:00Z");
      await db.query("select app_private.decide_due_checkins()");
      await db.as.user(others[1]!);
      await expectDenied(db, "select public.moderate_checkin($1, 'фейк')", [checkin], "admin_only");
      await db.as.user(author); // owner, но это его отметка
      await expectDenied(db, "select public.moderate_checkin($1, 'фейк')", [checkin], "cannot_vote_own");
      await db.as.user(others[0]!);
      await db.query("select public.moderate_checkin($1, 'Фото из интернета')", [checkin]);
      expect((await status(db, checkin)).status).toBe("rejected");
    }));
});

describe("лента: комментарии и реакции", () => {
  it("реакция переключается, чужак не может комментировать", () =>
    tx(async (db) => {
      const { others, checkin } = await world(db, 2);
      await db.as.user(others[0]!);
      expect((await db.query("select public.toggle_reaction($1, '🔥') as on", [checkin])).rows[0].on).toBe(true);
      expect((await db.query("select public.toggle_reaction($1, '🔥') as on", [checkin])).rows[0].on).toBe(false);
      await expectDenied(db, "select public.toggle_reaction($1, 'x')", [checkin], "invalid_reaction");
      await db.query("select public.add_comment($1, 'Красавчик!')", [checkin]);
      const mallory = await createUser(db);
      await db.as.user(mallory);
      await expectDenied(db, "select public.add_comment($1, 'спам')", [checkin], "checkin_not_found");
    }));
});

describe("пруфы", () => {
  it("похожее изображение (≤ 6 бит разницы) помечается, непохожее — нет", () =>
    tx(async (db) => {
      await setClock(db, T0);
      const a = await createUser(db);
      const g = await createGroup(db, a);
      await db.as.service();
      await db.query("select public.register_proof($1, $2, 'p/1', 'ff00ff00ff00ff00', null)", [a, g]);
      const near = await db.query("select flags from public.register_proof($1, $2, 'p/2', 'ff00ff00ff00ff0f', null)", [a, g]);
      expect(near.rows[0].flags).toEqual(["duplicate_image"]);
      const far = await db.query("select flags from public.register_proof($1, $2, 'p/3', '00ff00ff00ff00ff', null)", [a, g]);
      expect(far.rows[0].flags).toEqual([]);
    }));

  it("неиспользованный пруф можно удалить, использованный — нет", () =>
    tx(async (db) => {
      await setClock(db, T0);
      const a = await createUser(db);
      const g = await createGroup(db, a);
      const h = await createHabit(db, g, a, { proof: "photo" });
      await db.as.service();
      const p1 = (await db.query("select id from public.register_proof($1, $2, 'p/a', null, null)", [a, g])).rows[0].id;
      const p2 = (await db.query("select id from public.register_proof($1, $2, 'p/b', null, null)", [a, g])).rows[0].id;
      await db.as.user(a);
      await db.query("select public.create_checkin($1, null, $2)", [h, p1]);
      await db.as.service();
      expect((await db.query("select public.discard_proof($1) as p", [p1])).rows[0].p).toBeNull();
      expect((await db.query("select public.discard_proof($1) as p", [p2])).rows[0].p).toBe("p/b");
      await db.as.user(a);
      const err = await attempt(db, "select public.discard_proof($1)", [p1]);
      expect(err?.code).toBe("42501");
    }));
});
