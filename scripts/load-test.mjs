// Нагрузочная проверка ключевых запросов на синтетических данных.
//   node scripts/load-test.mjs [groups=200] [days=60]
// Создаёт отдельную БД orle_perf (шим Supabase + миграции), заполняет её
// set-based вставками и печатает время ключевых запросов (EXPLAIN ANALYZE).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const GROUPS = Number(process.argv[2] ?? 200);
const DAYS = Number(process.argv[3] ?? 60);
const MEMBERS = 8;
const HABITS = 4;
const root = path.resolve(import.meta.dirname, "..");

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query("drop database if exists orle_perf with (force)");
await admin.query("create database orle_perf");
await admin.end();

const url = new URL(ADMIN_URL);
url.pathname = "/orle_perf";
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
await db.query(readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
for (const f of readdirSync(path.join(root, "supabase/migrations")).sort()) {
  await db.query(readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
}

const t0 = Date.now();
const today = "2026-10-09";
await db.query(`insert into app_private.test_clock values (1, '${today}T05:00:00Z')`);
// Генерация: триггеры журнала/достижений не нужны для замеров чтения.
await db.query("set session_replication_role = replica");
await db.query(`
  insert into auth.users (id, email)
  select gen_random_uuid(), 'u' || i || '@perf.test' from generate_series(1, ${GROUPS * MEMBERS}) i;
  insert into public.profiles (id, display_name, nickname, character_seed, onboarded_at)
  select id, email, 'user' || row_number() over (), email, now() from auth.users;

  create temp table u as select id, row_number() over (order by email) as n from auth.users;

  insert into public.groups (id, name, created_by, rules, scoring_config)
  select gen_random_uuid(), 'G' || g, (select id from u where n = (g - 1) * ${MEMBERS} + 1),
         app_private.default_rules(), app_private.default_scoring_config()
    from generate_series(1, ${GROUPS}) g;
  create temp table gg as select id, row_number() over (order by name) as g from public.groups;

  insert into public.group_members (group_id, user_id, role)
  select gg.id, u.id, case when (u.n - 1) % ${MEMBERS} = 0 then 'owner'::public.group_role else 'member' end
    from u join gg on gg.g = (u.n - 1) / ${MEMBERS} + 1;

  insert into public.seasons (group_id, number, starts_on, ends_on)
  select id, 1, '${today}'::date - ${DAYS}, '${today}'::date + 30 from gg;

  insert into public.habits (group_id, user_id, title, description, frequency, target_count, proof_type, status, active_from, periods_generated_until)
  select m.group_id, m.user_id, 'Habit ' || h, 'Описание привычки ' || h, 'daily', 1, 'honor', 'active',
         '${today}'::date - ${DAYS}, '${today}'::date
    from public.group_members m, generate_series(1, ${HABITS}) h;

  insert into public.periods (habit_id, group_id, user_id, period_start, period_end, status, done_count, required_count, streak_after, settled_at)
  select h.id, h.group_id, h.user_id, d::date, d::date + 1,
         case when d::date < '${today}'::date - 1 then 'settled'::public.period_status else 'open' end,
         1, 1, (extract(day from d)::int % 9), now()
    from public.habits h, generate_series('${today}'::date - ${DAYS}, '${today}'::date, interval '1 day') d;

  insert into public.checkins (habit_id, group_id, user_id, period_start, local_date, slot, status, created_at, review_until)
  select p.habit_id, p.group_id, p.user_id, p.period_start, p.period_start, 1,
         case when p.period_start >= '${today}'::date - 1 then 'pending'::public.checkin_status else 'approved' end,
         (p.period_start::timestamp + interval '9 hours') at time zone 'Asia/Almaty',
         (p.period_start::timestamp + interval '33 hours') at time zone 'Asia/Almaty'
    from public.periods p where random() < 0.75;

  insert into public.checkin_votes (checkin_id, voter_id, group_id, vote, weight, created_at)
  select c.id, m.user_id, c.group_id, 'confirm', 1, c.created_at + interval '1 hour'
    from public.checkins c join public.group_members m on m.group_id = c.group_id and m.user_id <> c.user_id
   where random() < 0.2;

  insert into public.points_ledger (group_id, season_id, user_id, event_type, amount, checkin_id, reason, idempotency_key, created_at)
  select c.group_id, s.id, c.user_id, 'checkin', 5, c.id, 'x', 'checkin:' || c.id, c.created_at + interval '1 day'
    from public.checkins c join public.seasons s on s.group_id = c.group_id where c.status = 'approved';
`);
await db.query("set session_replication_role = origin");
await db.query("analyze");

const counts = (
  await db.query(`select
    (select count(*) from public.habits) habits, (select count(*) from public.periods) periods,
    (select count(*) from public.checkins) checkins, (select count(*) from public.checkin_votes) votes,
    (select count(*) from public.points_ledger) ledger`)
).rows[0];
console.log(`generated in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, counts);

const { rows: pick } = await db.query("select m.group_id, m.user_id from public.group_members m limit 1");
const { group_id: G, user_id: U } = pick[0];

async function asUser(sql, params = []) {
  await db.query("begin");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U, role: "authenticated" })]);
  await db.query("set local role authenticated");
  const res = await db.query(`explain (analyze, format json) ${sql}`, params);
  await db.query("rollback");
  return res.rows[0]["QUERY PLAN"][0]["Execution Time"];
}

const cases = [
  ["my_today()", "select * from public.my_today()"],
  ["group_arena()", "select * from public.group_arena($1)", [G]],
  ["leaderboard(week)", "select * from public.leaderboard($1, 'week')", [G]],
  ["leaderboard(all)", "select * from public.leaderboard($1, 'all')", [G]],
  [
    "лента (20 отметок + голоса/реакции)",
    `select c.*, (select json_agg(v) from public.checkin_votes v where v.checkin_id = c.id) votes,
            (select json_agg(r) from public.checkin_reactions r where r.checkin_id = c.id) reactions
       from public.checkins c where c.group_id = $1 order by c.created_at desc limit 20`,
    [G],
  ],
  ["журнал участника (50 записей)", "select * from public.points_ledger where group_id = $1 and user_id = $2 order by id desc limit 50", [G, U]],
];

const results = [];
for (const [name, sql, params] of cases) {
  const times = [];
  for (let i = 0; i < 5; i++) times.push(await asUser(sql, params));
  times.sort((a, b) => a - b);
  results.push({ query: name, "median ms": times[2].toFixed(2), "max ms": times[4].toFixed(2) });
}

// Тик: подвести вчерашний день для всех привычек (как ночной крон).
await db.query("update app_private.test_clock set frozen_at = $1", [`${today}T20:00:00Z`]);
let t = Date.now();
const first = (await db.query("select app_private.tick() as r")).rows[0].r;
results.push({ query: `tick() — решения ${first.checkins_decided}, периоды ${first.periods_settled}`, "median ms": String(Date.now() - t), "max ms": "" });
t = Date.now();
await db.query("select app_private.tick()");
results.push({ query: "tick() повторно (идемпотентность)", "median ms": String(Date.now() - t), "max ms": "" });

console.table(results);
await db.end();
