-- Orle: базовая схема.
-- Принципы:
--   * клиент (роль authenticated) только ЧИТАЕТ таблицы своих групп;
--   * любая запись идёт через SECURITY DEFINER-функции (см. 0300_rpc.sql),
--     которые проверяют права, серверное время и инварианты;
--   * очки — append-only журнал points_ledger.

create schema if not exists extensions;
create extension if not exists citext with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public;

-- Новые таблицы в public не должны автоматически получать права для клиентов.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges in schema app_private revoke execute on functions from anon, authenticated, public;

-- ---------------------------------------------------------------- enums
create type public.group_role as enum ('owner', 'admin', 'member');
create type public.habit_frequency as enum ('daily', 'weekly', 'monthly');
create type public.proof_type as enum ('photo', 'photo_text', 'honor');
create type public.habit_difficulty as enum ('easy', 'medium', 'hard');
create type public.habit_status as enum ('proposed', 'active', 'rejected', 'archived');
create type public.habit_vote_kind as enum ('approve', 'reject', 'request_changes');
create type public.checkin_status as enum ('pending', 'approved', 'rejected');
create type public.checkin_vote_kind as enum ('confirm', 'dispute');
create type public.period_status as enum ('open', 'settled');
create type public.season_status as enum ('active', 'closed');
create type public.ledger_event as enum (
  'checkin',        -- очки за подтверждённую отметку
  'period_bonus',   -- +20% за полное выполнение периода «N раз»
  'streak_bonus',   -- надбавка множителя стрика
  'miss_penalty',   -- пропуск периода
  'fake_revoke',    -- отзыв очков за отклонённую отметку
  'fake_penalty',   -- штраф за фейк
  'adjustment'      -- ручная корректировка (только сервер, с причиной)
);
create type public.cosmetic_kind as enum ('frame', 'background', 'accessory');

-- --------------------------------------------------------------- clock
-- Серверное «сейчас». В проде таблица пуста → now(). Тесты и seed могут
-- зафиксировать время. Клиенты к схеме app_private доступа не имеют.
create table app_private.test_clock (
  id int primary key default 1 check (id = 1),
  frozen_at timestamptz not null
);

create function app_private.now() returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select coalesce((select frozen_at from app_private.test_clock where id = 1), now());
$$;

-- ------------------------------------------------------------ profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(btrim(display_name)) between 1 and 40),
  nickname extensions.citext unique check (nickname ~ '^[A-Za-z0-9_]{3,20}$'),
  character_seed text check (char_length(character_seed) between 1 and 64),
  locale text not null default 'ru' check (locale in ('ru', 'kk', 'en')),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint onboarded_complete check (
    onboarded_at is null
    or (display_name is not null and nickname is not null and character_seed is not null)
  )
);

-- -------------------------------------------------------------- groups
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  avatar_url text,
  timezone text not null default 'Asia/Almaty',
  season_days int not null default 30 check (season_days between 7 and 365),
  max_members int not null default 12 check (max_members between 2 and 50),
  rules jsonb not null,
  scoring_config jsonb not null,
  -- Изменения таймзоны/правил/коэффициентов применяются со следующего периода.
  pending_changes jsonb,
  pending_effective_from date,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);
-- Ровно один owner в группе.
create unique index group_members_one_owner on public.group_members (group_id) where role = 'owner';

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz,
  max_uses int check (max_uses > 0),
  uses int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_group_idx on public.invites (group_id);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  number int not null check (number > 0),
  starts_on date not null,
  ends_on date not null,               -- исключительно
  status public.season_status not null default 'active',
  closed_at timestamptz,
  unique (group_id, number),
  check (ends_on > starts_on)
);
create unique index seasons_one_active on public.seasons (group_id) where status = 'active';

-- -------------------------------------------------------------- habits
create table public.habits (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  user_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 80),
  description text not null check (char_length(btrim(description)) between 10 and 500),
  frequency public.habit_frequency not null,
  target_count smallint not null default 1,
  proof_type public.proof_type not null,
  difficulty public.habit_difficulty not null default 'medium',
  status public.habit_status not null default 'proposed',
  -- Активна для периодов, начинающихся в [active_from, active_until).
  active_from date,
  active_until date,
  -- Если правка заменяет старую привычку — ссылка на неё.
  replaces_habit_id uuid references public.habits (id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (group_id, user_id) references public.group_members (group_id, user_id) on delete cascade,
  check (
    (frequency = 'daily' and target_count = 1)
    or (frequency = 'weekly' and target_count between 1 and 7)
    or (frequency = 'monthly' and target_count between 1 and 28)
  ),
  check (active_until is null or active_from is null or active_until >= active_from)
);
create index habits_group_user_idx on public.habits (group_id, user_id);
create index habits_group_status_idx on public.habits (group_id, status);

create table public.habit_votes (
  habit_id uuid not null references public.habits (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  vote public.habit_vote_kind not null,
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (habit_id, voter_id)
);

-- ------------------------------------------------------------- seasons/periods
create table public.periods (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  period_start date not null,
  period_end date not null,            -- исключительно
  status public.period_status not null default 'open',
  done_count smallint not null default 0,
  frozen_days smallint not null default 0,
  required_count smallint,
  streak_after int,
  settled_at timestamptz,
  unique (habit_id, period_start),
  check (period_end > period_start)
);
create index periods_open_idx on public.periods (status, period_end) where status = 'open';
create index periods_group_user_idx on public.periods (group_id, user_id);

-- ------------------------------------------------------------ checkins
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  period_start date not null,
  local_date date not null,
  slot smallint not null check (slot > 0),
  note text check (char_length(note) <= 500),
  status public.checkin_status not null default 'pending',
  created_at timestamptz not null default now(),   -- ставит сервер
  review_until timestamptz not null,
  decided_at timestamptz,
  decision_reason text,
  -- Одна отметка на слот периода.
  unique (habit_id, period_start, slot)
);
-- Не больше одной действующей отметки привычки за локальные сутки.
create unique index checkins_one_per_day on public.checkins (habit_id, local_date) where status <> 'rejected';
create index checkins_group_created_idx on public.checkins (group_id, created_at desc);
create index checkins_user_created_idx on public.checkins (user_id, created_at desc);
create index checkins_pending_idx on public.checkins (review_until) where status = 'pending';

create table public.proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  checkin_id uuid unique references public.checkins (id) on delete cascade,
  storage_path text not null unique,
  phash text check (phash ~ '^[0-9a-f]{16}$'),
  exif_taken_at timestamptz,
  uploaded_at timestamptz not null default now(),
  flags text[] not null default '{}'
);
create index proofs_group_phash_idx on public.proofs (group_id, phash);

create table public.checkin_votes (
  checkin_id uuid not null references public.checkins (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  vote public.checkin_vote_kind not null,
  weight numeric(5, 3) not null check (weight > 0 and weight <= 1),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  primary key (checkin_id, voter_id),
  check (vote = 'confirm' or char_length(btrim(comment)) > 0)
);
create index checkin_votes_voter_idx on public.checkin_votes (voter_id, created_at);

create table public.checkin_reactions (
  checkin_id uuid not null references public.checkins (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  emoji text not null check (emoji in ('🔥', '💪', '👏', '😂', '🤔')),
  created_at timestamptz not null default now(),
  primary key (checkin_id, user_id, emoji)
);

create table public.checkin_comments (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index checkin_comments_checkin_idx on public.checkin_comments (checkin_id, created_at);

create table public.freezes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,               -- включительно
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on < 14)
);
create index freezes_group_user_idx on public.freezes (group_id, user_id, starts_on);

-- ------------------------------------------------------- points ledger
create table public.points_ledger (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  season_id uuid references public.seasons (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type public.ledger_event not null,
  amount numeric(10, 2) not null,
  habit_id uuid references public.habits (id) on delete set null,
  checkin_id uuid references public.checkins (id) on delete set null,
  period_id uuid references public.periods (id) on delete set null,
  reason text not null,
  details jsonb not null default '{}',
  -- Гарантирует идемпотентность крона: одно событие — одна запись.
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index points_ledger_group_user_idx on public.points_ledger (group_id, user_id, created_at);
create index points_ledger_group_created_idx on public.points_ledger (group_id, created_at);

create function app_private.ledger_is_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'points_ledger is append-only' using errcode = '42501';
end;
$$;

create trigger points_ledger_no_update before update or delete on public.points_ledger
  for each row execute function app_private.ledger_is_append_only();
create trigger points_ledger_no_truncate before truncate on public.points_ledger
  for each statement execute function app_private.ledger_is_append_only();

-- ----------------------------------------------------- achievements
create table public.cosmetics (
  code text primary key,
  kind public.cosmetic_kind not null,
  sort_order int not null default 0
);

create table public.achievements (
  code text primary key,
  cosmetic_code text references public.cosmetics (code),
  sort_order int not null default 0
);

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  achievement_code text not null references public.achievements (code),
  earned_at timestamptz not null default now(),
  primary key (user_id, group_id, achievement_code)
);

create table public.equipped_cosmetics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.cosmetic_kind not null,
  cosmetic_code text not null references public.cosmetics (code),
  primary key (user_id, kind)
);

-- ------------------------------------------------------- audit / ops
create table public.audit_log (
  id bigint generated always as identity primary key,
  group_id uuid references public.groups (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null,
  severity smallint not null default 1 check (severity between 1 and 3),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id)
);
create index audit_log_group_idx on public.audit_log (group_id, created_at desc);

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  evening_reminder boolean not null default true,
  reminder_time time not null default '20:00',
  checkin_disputed boolean not null default true,
  weekly_digest boolean not null default true,
  via_push boolean not null default true,
  via_email boolean not null default true
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------- auth → profile
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();
