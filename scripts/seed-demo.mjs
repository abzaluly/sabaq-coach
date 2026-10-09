// Демо-данные: группа из 4 человек и история за 3 недели — стрики, пропуски,
// заморозка, частичное выполнение, спорные и отклонённые отметки, «читер» с повтором фото.
//
//   pnpm seed:demo
//
// Использует: SEED_DATABASE_URL (суперпользователь Postgres проекта), NEXT_PUBLIC_SUPABASE_URL и
// SUPABASE_SERVICE_ROLE_KEY из .env.local. Время «прокручивается» через app_private.test_clock,
// поэтому все проверки и начисления идут через настоящие серверные функции.
// ТОЛЬКО для локальной/тестовой базы: скрипт удаляет прежних демо-пользователей (*@demo.orle).
import { readFileSync } from "node:fs";
import pg from "pg";
import sharp from "sharp";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL =
  process.env.SEED_DATABASE_URL ??
  (SUPABASE?.includes("54321") && process.env.LOCAL_STACK !== "0"
    ? "postgres://postgres:postgres@127.0.0.1:5432/orle_dev"
    : "postgres://postgres:postgres@127.0.0.1:54322/postgres");
const TZ = "Asia/Almaty";
const DAYS = 21;

if (!SUPABASE || !SERVICE) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы");
const headers = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();

// --------------------------------------------------------------- helpers
const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** Локальное время Алматы (UTC+5) → ISO. */
const at = (day, hh, mm = 0) => new Date(Date.UTC(...day.split("-").map((v, i) => (i === 1 ? v - 1 : +v)), hh - 5, mm)).toISOString();
const clock = (iso) =>
  db.query("insert into app_private.test_clock (id, frozen_at) values (1, $1) on conflict (id) do update set frozen_at = excluded.frozen_at", [iso]);

async function as(uid, sql, params = []) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    const res = await db.query(sql, params);
    await db.query("commit");
    return res.rows;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
async function tryAs(uid, sql, params) {
  try {
    return await as(uid, sql, params);
  } catch (e) {
    return { error: e.message };
  }
}

let seedRand = 42;
const rand = () => ((seedRand = (seedRand * 16807) % 2147483647) / 2147483647);

// ---------------------------------------------------------- photos (proofs)
async function dHash(buf) {
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

async function makePhoto(hue, variant) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <rect width="900" height="900" fill="hsl(${hue},55%,82%)"/>
    <circle cx="${200 + ((variant * 97) % 500)}" cy="${250 + ((variant * 61) % 400)}" r="${120 + (variant % 5) * 25}" fill="hsl(${(hue + 40) % 360},60%,45%)"/>
    <rect x="${80 + ((variant * 53) % 300)}" y="560" width="${300 + (variant % 4) * 60}" height="180" rx="40" fill="hsl(${(hue + 200) % 360},50%,35%)"/>
    <path d="M0 ${700 + (variant % 7) * 20} Q450 ${560 + (variant % 3) * 60} 900 ${720 - (variant % 5) * 20} V900 H0Z" fill="hsl(${(hue + 120) % 360},45%,55%)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

async function proof(uid, groupId, image, exifTakenAt = null) {
  const path = `${groupId}/${uid}/${crypto.randomUUID()}.webp`;
  const res = await fetch(`${SUPABASE}/storage/v1/object/proofs/${path}`, {
    method: "POST",
    headers: { ...headers, "content-type": "image/webp" },
    body: image,
  });
  if (!res.ok) throw new Error(`storage upload ${res.status}: ${await res.text()}`);
  const { rows } = await db.query("select id from public.register_proof($1, $2, $3, $4, $5)", [uid, groupId, path, await dHash(image), exifTakenAt]);
  return rows[0].id;
}

// -------------------------------------------------------------- cleanup
await db.query("delete from public.groups where name = 'Утренние жаворонки (демо)'");
const { rows: old } = await db.query("select id from auth.users where email like '%@demo.orle'");
for (const { id } of old) {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/users/${id}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`delete user ${res.status}`);
}
if (old.length) console.log(`удалено прежних демо-пользователей: ${old.length}`);

// ---------------------------------------------------------------- users
const people = [
  { key: "aliya", name: "Алия", seed: "aliya-demo-7" },
  { key: "baur", name: "Бауыржан", seed: "baur-demo-3" },
  { key: "dana", name: "Дана", seed: "dana-demo-11" },
  { key: "timur", name: "Тимур", seed: "timur-demo-5" },
];
const U = {};
for (const p of people) {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: `${p.key}@demo.orle`, email_confirm: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`create user: ${JSON.stringify(json)}`);
  U[p.key] = json.id;
  await as(json.id, "select public.complete_onboarding($1, $2, $3)", [p.name, `${p.key}_demo`, p.seed]);
}

// ---------------------------------------------------------------- group
const start = addDays(localToday, -DAYS);
await clock(at(start, 8));
const [group] = await as(U.aliya, "select id from public.create_group('Утренние жаворонки (демо)', $1, 30, 8)", [TZ]);
const G = group.id;
await as(U.aliya, `select public.update_group_settings($1, p_rules => '{"confirmationsToApprove": 2}')`, [G]);
await db.query("select app_private.apply_pending_group_changes()"); // демо: правила сразу
await db.query("update public.groups set rules = pending_changes -> 'rules', pending_changes = null, pending_effective_from = null where id = $1 and pending_changes is not null", [G]);
const [invite] = await as(U.aliya, "select code from public.create_invite($1, 720)", [G]);
for (const k of ["baur", "dana", "timur"]) await as(U[k], "select public.join_group($1)", [invite.code]);

// ---------------------------------------------------------------- habits
const habitDefs = [
  { who: "aliya", title: "Бег 3 км", desc: "Пробежка от 3 км, на фото — экран трекера", freq: "weekly", n: 3, proof: "photo", diff: "medium" },
  { who: "aliya", title: "Чтение", desc: "20 страниц книги перед сном", freq: "daily", n: 1, proof: "honor", diff: "easy" },
  { who: "baur", title: "Отжимания", desc: "30 отжиманий за подход, фото в упоре", freq: "daily", n: 1, proof: "photo", diff: "medium" },
  { who: "dana", title: "Медитация", desc: "10 минут медитации, фото + пара слов", freq: "daily", n: 1, proof: "photo_text", diff: "easy" },
  { who: "dana", title: "Английский", desc: "Урок английского 30 минут", freq: "weekly", n: 2, proof: "honor", diff: "medium" },
  { who: "timur", title: "Спортзал", desc: "Тренировка в зале от 45 минут, фото в зале", freq: "weekly", n: 3, proof: "photo", diff: "hard" },
];
const H = {};
for (const h of habitDefs) {
  const [row] = await as(U[h.who], "select id from public.propose_habit($1, $2, $3, $4, $5, $6, $7)", [G, h.title, h.desc, h.freq, h.n, h.proof, h.diff]);
  H[h.title] = { ...h, id: row.id };
}
// Тимур сначала предложил неизмеримую формулировку — группа попросила уточнить.
await as(U.aliya, "select public.vote_habit($1, 'request_changes', 'Сколько минут? Что на фото?')", [H["Спортзал"].id]);
for (const h of Object.values(H)) {
  for (const k of Object.keys(U)) if (k !== h.who) await tryAs(U[k], "select public.vote_habit($1, 'approve')", [h.id]);
}
// Активируем все привычки с первого дня демо.
await db.query("update public.habits set active_from = $1, periods_generated_until = null where group_id = $2 and status = 'active'", [start, G]);

// Дана заранее объявила поездку на 3 дня.
await clock(at(addDays(start, 8), 20));
await as(U.dana, "select public.declare_freeze($1, $2, $3, 'Поездка к родителям')", [G, addDays(start, 11), addDays(start, 13)]);

// ------------------------------------------------------------- history
const hue = { aliya: 20, baur: 210, dana: 280, timur: 120 };
let timurPhoto = null;
let variant = 0;
let timurCount = 0;
const disputed = [];

for (let d = 0; d <= DAYS; d++) {
  const day = addDays(start, d);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = вс
  await clock(at(day, 8));
  await db.query("select app_private.tick()");
  await clock(at(day, 9, 30));

  const checkin = async (who, title, opts = {}) => {
    const h = H[title];
    let proofId = null;
    if (h.proof !== "honor") {
      let image;
      if (who === "timur" && timurPhoto && opts.reuse) image = timurPhoto;
      else image = await makePhoto(hue[who], variant++);
      if (who === "timur" && !timurPhoto) timurPhoto = image;
      proofId = await proof(U[who], G, image, opts.oldPhoto ? at(addDays(day, -60), 12) : at(day, 9));
    }
    const note = h.proof === "photo_text" ? opts.note ?? "Спокойное утро, 10 минут" : null;
    const rows = await tryAs(U[who], "select id from public.create_checkin($1, $2, $3)", [h.id, note, proofId]);
    return rows.error ? null : rows[0].id;
  };

  const today = [];
  // Алия: читает каждый день, бегает пн/ср/пт — длинный стрик.
  today.push(await checkin("aliya", "Чтение"));
  if ([1, 3, 5].includes(dow)) today.push(await checkin("aliya", "Бег 3 км"));
  // Бауыржан: пропускает ~каждый четвёртый день.
  if (rand() > 0.25) today.push(await checkin("baur", "Отжимания"));
  // Дана: медитирует ежедневно (кроме заморозки), английский иногда — частично.
  if (!(d >= 11 && d <= 13)) today.push(await checkin("dana", "Медитация"));
  if ([2, 6].includes(dow) && rand() > 0.35) today.push(await checkin("dana", "Английский"));
  // Тимур: зал вт/чт/сб, но дважды выкладывает старое/то же фото.
  if ([2, 4, 6].includes(dow)) {
    timurCount++;
    // 2-я отметка — тот же кадр (повтор), 5-я — тот же кадр со старой датой съёмки.
    const cheat = timurCount === 2 || timurCount === 5;
    const id = await checkin("timur", "Спортзал", { reuse: cheat, oldPhoto: timurCount === 5 });
    today.push(id);
    if (cheat && id) disputed.push({ id, nth: timurCount });
  }

  // Днём группа проверяет отметки.
  await clock(at(day, 13));
  const { rows: pending } = await db.query("select id, user_id from public.checkins where group_id = $1 and local_date = $2 and status = 'pending'", [G, day]);
  for (const c of pending) {
    const fake = disputed.find((x) => x.id === c.id);
    for (const k of Object.keys(U)) {
      if (U[k] === c.user_id) continue;
      if (fake) {
        if (k === "aliya") await tryAs(U[k], "select public.vote_checkin($1, 'dispute', $2)", [c.id, "Это фото уже было на прошлой неделе"]);
        if (k === "dana") await tryAs(U[k], "select public.vote_checkin($1, 'dispute', $2)", [c.id, "Согласна, тот же кадр"]);
        if (k === "baur" && fake.nth === 2) await tryAs(U[k], "select public.vote_checkin($1, 'confirm')", [c.id]);
      } else if (rand() < 0.55 && d < DAYS) {
        await tryAs(U[k], "select public.vote_checkin($1, 'confirm')", [c.id]);
      }
    }
  }
  // Реакции и комментарии для живости ленты.
  for (const c of pending.slice(0, 2)) {
    await tryAs(U.aliya === c.user_id ? U.baur : U.aliya, "select public.toggle_reaction($1, '🔥')", [c.id]);
  }
  if (d === DAYS - 1 && pending[0]) await tryAs(U.dana, "select public.add_comment($1, 'Так держать!')", [pending[0].id]);
}

// Сегодня: часть отметок ещё на проверке, одна — спорная.
await clock(at(localToday, 8, 30));
await db.query("select app_private.tick()");
await db.query("delete from app_private.test_clock");
await db.query("select app_private.tick()");

// ---------------------------------------------------------------- summary
const { rows: summary } = await db.query(
  `select p.display_name, coalesce(sum(l.amount), 0)::float as points,
          count(*) filter (where l.event_type = 'miss_penalty') as misses,
          count(*) filter (where l.event_type = 'fake_penalty') as fakes,
          (select max(streak_after) from public.periods pr where pr.user_id = p.id and pr.group_id = $1) as best_streak
     from public.profiles p join public.group_members m on m.user_id = p.id and m.group_id = $1
     left join public.points_ledger l on l.user_id = p.id and l.group_id = $1
    group by p.id, p.display_name order by points desc`,
  [G],
);
console.table(summary);
const { rows: flags } = await db.query("select count(*) filter (where cardinality(flags) > 0) as flagged from public.proofs where group_id = $1", [G]);
console.log(`подозрительных фото: ${flags[0].flagged}; вход: aliya@demo.orle / baur@ / dana@ / timur@ (код придёт в локальную почту)`);
await db.end();
