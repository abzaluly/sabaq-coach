import pg from "pg";
import { afterAll, expect } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

function testUrl() {
  if (process.env.TEST_SUPABASE === "1") return ADMIN_URL;
  const url = new URL(ADMIN_URL);
  url.pathname = "/orle_test";
  return url.toString();
}

const pool = new pg.Pool({ connectionString: testUrl(), max: 4 });
afterAll(async () => {
  await pool.end();
});

export type Db = pg.PoolClient & { as: Actor };

type Actor = {
  user(id: string): Promise<void>;
  anon(): Promise<void>;
  service(): Promise<void>;
  admin(): Promise<void>;
};

/**
 * Каждый тест работает в своей транзакции, которая откатывается в конце.
 * Внутри можно переключаться между ролями: admin (суперпользователь, для
 * подготовки данных), user(id) — клиент с JWT, anon, service.
 */
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = (await pool.connect()) as Db;
  client.as = {
    async user(id) {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: id, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
    },
    async anon() {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await client.query("set local role anon");
    },
    async service() {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "service_role" }),
      ]);
      await client.query("set local role service_role");
    },
    async admin() {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', '', true)");
    },
  };
  await client.query("begin");
  try {
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

/** Выполняет запрос в savepoint и возвращает ошибку (или null). */
export async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<pg.DatabaseError | null> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return null;
  } catch (err) {
    await db.query("rollback to savepoint attempt");
    return err as pg.DatabaseError;
  }
}

/** Ожидает отказ: либо по правам/RLS (42501), либо бизнес-ошибку с кодом. */
export async function expectDenied(db: Db, sql: string, params: unknown[] = [], code?: string) {
  const err = await attempt(db, sql, params);
  expect(err, `expected failure for: ${sql}`).not.toBeNull();
  if (code) expect(err?.message).toBe(code);
  else expect(["42501", "P0001"]).toContain(err?.code);
  return err!;
}

// ------------------------------------------------------------ fixtures
// Все фикстуры выполняются от суперпользователя (db.as.admin()).

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function setClock(db: Db, iso: string) {
  await db.as.admin();
  await db.query(
    "insert into app_private.test_clock (id, frozen_at) values (1, $1) on conflict (id) do update set frozen_at = excluded.frozen_at",
    [iso],
  );
}

export async function createUser(db: Db, nickname?: string): Promise<string> {
  await db.as.admin();
  const nick = nickname ?? `u_${uniq()}`.slice(0, 20);
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [`${nick}@example.test`],
  );
  const id = rows[0]!.id;
  await db.query(
    "update public.profiles set display_name = $2, nickname = $3, character_seed = $4, onboarded_at = now() where id = $1",
    [id, nick, nick, nick],
  );
  return id;
}

export async function createGroup(
  db: Db,
  ownerId: string,
  opts: { timezone?: string; members?: string[] } = {},
): Promise<string> {
  await db.as.admin();
  const { rows } = await db.query<{ id: string }>(
    "insert into public.groups (name, timezone, created_by) values ('Test group', $1, $2) returning id",
    [opts.timezone ?? "Asia/Almaty", ownerId],
  );
  const groupId = rows[0]!.id;
  await db.query("insert into public.group_members (group_id, user_id, role) values ($1, $2, 'owner')", [
    groupId,
    ownerId,
  ]);
  for (const m of opts.members ?? []) {
    await db.query("insert into public.group_members (group_id, user_id) values ($1, $2)", [groupId, m]);
  }
  await db.query(
    "insert into public.seasons (group_id, number, starts_on, ends_on) values ($1, 1, '2026-01-01', '2027-01-01')",
    [groupId],
  );
  return groupId;
}

export async function createHabit(
  db: Db,
  groupId: string,
  userId: string,
  opts: {
    frequency?: "daily" | "weekly" | "monthly";
    target?: number;
    proof?: "photo" | "photo_text" | "honor";
    activeFrom?: string;
  } = {},
): Promise<string> {
  await db.as.admin();
  const { rows } = await db.query<{ id: string }>(
    `insert into public.habits (group_id, user_id, title, description, frequency, target_count, proof_type, status, active_from)
     values ($1, $2, 'Отжимания', '30 отжиманий за один подход', $3, $4, $5, 'active', $6) returning id`,
    [groupId, userId, opts.frequency ?? "daily", opts.target ?? 1, opts.proof ?? "honor", opts.activeFrom ?? "2026-01-01"],
  );
  return rows[0]!.id;
}
