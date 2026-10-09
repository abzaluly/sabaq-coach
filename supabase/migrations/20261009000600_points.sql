-- Orle, этап 4: движок очков.
--
-- Все начисления — записи в append-only points_ledger с уникальным idempotency_key.
-- Повторный запуск любой функции здесь не начисляет дважды.
--
-- Формула (коэффициенты — groups.scoring_config, дефолты в config/scoring.ts):
--   база(h)        = base[частота] × difficulty[сложность] × (honor ? honorMultiplier : 1)
--   за отметку     = база / N                       — при одобрении отметки
--   бонус периода  = база × fullPeriodBonus         — если N > 1 и период выполнен полностью
--   бонус стрика   = (очки периода + бонус) × (множитель − 1),
--                    множитель = min(1 + streakStep × стрик, streakMaxMultiplier),
--                    стрик — с учётом только что выполненного периода
--   пропуск        = −база × missPenalty            — 0 одобренных отметок; стрик = 0
--   частично       = очки за отметки остаются, бонусов нет, стрик = 0, без штрафа
--   фейк           = −(начисленное за отметку) − fakePenaltyMultiplier × база / N
--   заморозка      = замороженные дни пропорционально уменьшают N (округление);
--                    если N стало 0 — период пропускается: без штрафа, стрик не меняется.

-- ------------------------------------------------------------- helpers
create function app_private.habit_base(p_habit public.habits, p_cfg jsonb) returns numeric
language sql immutable set search_path = ''
as $$
  select round(
    (p_cfg -> 'base' ->> p_habit.frequency::text)::numeric
    * (p_cfg -> 'difficulty' ->> p_habit.difficulty::text)::numeric
    * case when p_habit.proof_type = 'honor' then (p_cfg ->> 'honorMultiplier')::numeric else 1 end,
    2);
$$;

create function app_private.season_for(p_group_id uuid, p_day date) returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.seasons
   where group_id = p_group_id and p_day >= starts_on and p_day < ends_on
   order by number desc limit 1;
$$;

create function app_private.credit(
  p_key text, p_group_id uuid, p_user_id uuid, p_event public.ledger_event, p_amount numeric,
  p_reason text, p_day date, p_habit_id uuid default null, p_checkin_id uuid default null,
  p_period_id uuid default null, p_details jsonb default '{}'
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.points_ledger (group_id, season_id, user_id, event_type, amount, habit_id, checkin_id, period_id,
                                    reason, details, idempotency_key, created_at)
  select p_group_id, app_private.season_for(p_group_id, p_day), p_user_id, p_event, round(p_amount, 2),
         p_habit_id, p_checkin_id, p_period_id, p_reason, coalesce(p_details, '{}'), p_key, app_private.now()
   where round(p_amount, 2) <> 0
  on conflict (idempotency_key) do nothing;
$$;

-- ----------------------------------------------------- check-in decisions
create or replace function app_private.on_checkin_decided(p_checkin_id uuid, p_previous public.checkin_status) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.checkins;
  v_h public.habits;
  v_cfg jsonb;
  v_per numeric;
  v_credited numeric;
begin
  select * into v_c from public.checkins where id = p_checkin_id;
  select * into v_h from public.habits where id = v_c.habit_id;
  select scoring_config into v_cfg from public.groups where id = v_c.group_id;
  v_per := app_private.habit_base(v_h, v_cfg) / v_h.target_count;

  if v_c.status = 'approved' then
    perform app_private.credit('checkin:' || v_c.id, v_c.group_id, v_c.user_id, 'checkin', v_per,
      'Отметка: ' || v_h.title, v_c.local_date, v_h.id, v_c.id, null,
      jsonb_build_object('base', app_private.habit_base(v_h, v_cfg), 'target', v_h.target_count));
  elsif v_c.status = 'rejected' then
    select coalesce(sum(amount), 0) into v_credited from public.points_ledger
     where checkin_id = v_c.id and event_type = 'checkin';
    if v_credited <> 0 then
      perform app_private.credit('revoke:' || v_c.id, v_c.group_id, v_c.user_id, 'fake_revoke', -v_credited,
        'Отзыв очков за отклонённую отметку: ' || v_h.title, v_c.local_date, v_h.id, v_c.id);
    end if;
    perform app_private.credit('fake:' || v_c.id, v_c.group_id, v_c.user_id, 'fake_penalty',
      -(v_cfg ->> 'fakePenaltyMultiplier')::numeric * v_per,
      'Штраф за отклонённую отметку: ' || v_h.title, v_c.local_date, v_h.id, v_c.id, null,
      jsonb_build_object('reason', v_c.decision_reason));
  end if;
end;
$$;

-- ---------------------------------------------------------------- periods
-- Создаёт строки периодов от active_from до текущего. Указатель periods_generated_until
-- нужен потому, что create_checkin создаёт текущий период «вне очереди», и по max(period_end)
-- пропущенные периоды до первой отметки потерялись бы (а с ними — штрафы).
alter table public.habits add column periods_generated_until date;

create function app_private.ensure_periods(p_habit_id uuid, p_today date) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_h public.habits;
  v_start date;
  v_b record;
  v_limit int := 400;
begin
  select * into v_h from public.habits where id = p_habit_id for update;
  if v_h.status <> 'active' or v_h.active_from is null then
    return;
  end if;
  v_start := coalesce(v_h.periods_generated_until, v_h.active_from);
  while v_start <= p_today and (v_h.active_until is null or v_start < v_h.active_until) and v_limit > 0 loop
    select * into v_b from app_private.period_bounds(v_h.frequency, v_start);
    insert into public.periods (habit_id, group_id, user_id, period_start, period_end, required_count)
    values (v_h.id, v_h.group_id, v_h.user_id, v_b.period_start, v_b.period_end, v_h.target_count)
    on conflict (habit_id, period_start) do nothing;
    v_start := v_b.period_end;
    v_limit := v_limit - 1;
  end loop;
  update public.habits set periods_generated_until = v_start where id = p_habit_id
     and periods_generated_until is distinct from v_start;
end;
$$;

-- Стрик до этого периода: последний подведённый период привычки (или заменённой ею).
create function app_private.prev_streak(p_habit public.habits, p_before date) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select p.streak_after from public.periods p
     where p.habit_id in (p_habit.id, p_habit.replaces_habit_id)
       and p.status = 'settled' and p.period_start < p_before
     order by p.period_start desc limit 1), 0);
$$;

create function app_private.settle_period(p_period_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.periods;
  v_h public.habits;
  v_g public.groups;
  v_cfg jsonb;
  v_base numeric;
  v_days int;
  v_frozen int;
  v_required int;
  v_approved int;
  v_prev int;
  v_streak int;
  v_earned numeric;
  v_bonus numeric := 0;
  v_mult numeric;
  v_outcome text;
  v_last_day date;
begin
  select * into v_p from public.periods where id = p_period_id for update;
  if v_p.status = 'settled' then
    return 'already';
  end if;
  select * into v_h from public.habits where id = v_p.habit_id;
  select * into v_g from public.groups where id = v_p.group_id;
  v_cfg := v_g.scoring_config;
  v_last_day := v_p.period_end - 1;

  -- Ушедший участник: период закрывается без последствий.
  if v_h.status = 'archived' or not exists (
    select 1 from public.group_members where group_id = v_p.group_id and user_id = v_p.user_id
  ) then
    update public.periods set status = 'settled', settled_at = app_private.now(), streak_after = null where id = p_period_id;
    return 'void';
  end if;

  v_base := app_private.habit_base(v_h, v_cfg);
  v_days := v_p.period_end - v_p.period_start;
  select coalesce(sum(least(f.ends_on, v_last_day) - greatest(f.starts_on, v_p.period_start) + 1), 0) into v_frozen
    from public.freezes f
   where f.group_id = v_p.group_id and f.user_id = v_p.user_id
     and f.starts_on <= v_last_day and f.ends_on >= v_p.period_start;
  v_frozen := least(v_frozen, v_days);
  v_required := round(v_h.target_count::numeric * (v_days - v_frozen) / v_days);

  select count(*) into v_approved from public.checkins
   where habit_id = v_p.habit_id and period_start = v_p.period_start and status = 'approved';
  select coalesce(sum(l.amount), 0) into v_earned
    from public.points_ledger l join public.checkins c on c.id = l.checkin_id
   where c.habit_id = v_p.habit_id and c.period_start = v_p.period_start and l.event_type = 'checkin' and c.status = 'approved';

  v_prev := app_private.prev_streak(v_h, v_p.period_start);

  if v_required = 0 then
    v_outcome := 'frozen';
    v_streak := v_prev;
  elsif v_approved >= v_required then
    v_outcome := 'complete';
    v_streak := v_prev + 1;
    if v_h.target_count > 1 then
      v_bonus := v_base * (v_cfg ->> 'fullPeriodBonus')::numeric;
      perform app_private.credit('period:' || v_p.id || ':full', v_p.group_id, v_p.user_id, 'period_bonus', v_bonus,
        'Полное выполнение периода: ' || v_h.title, v_last_day, v_h.id, null, v_p.id);
    end if;
    v_mult := least(1 + (v_cfg ->> 'streakStep')::numeric * v_streak, (v_cfg ->> 'streakMaxMultiplier')::numeric);
    perform app_private.credit('period:' || v_p.id || ':streak', v_p.group_id, v_p.user_id, 'streak_bonus',
      (v_earned + v_bonus) * (v_mult - 1),
      'Стрик ' || v_streak || ' (×' || trim_scale(v_mult) || '): ' || v_h.title, v_last_day, v_h.id, null, v_p.id,
      jsonb_build_object('streak', v_streak, 'multiplier', v_mult));
  elsif v_approved > 0 then
    v_outcome := 'partial';
    v_streak := 0;
  else
    v_outcome := 'missed';
    v_streak := 0;
    perform app_private.credit('period:' || v_p.id || ':miss', v_p.group_id, v_p.user_id, 'miss_penalty',
      -v_base * (v_cfg ->> 'missPenalty')::numeric,
      'Пропуск периода: ' || v_h.title, v_last_day, v_h.id, null, v_p.id);
  end if;

  update public.periods
     set status = 'settled', settled_at = app_private.now(), done_count = v_approved,
         frozen_days = v_frozen, required_count = v_required, streak_after = v_streak
   where id = p_period_id;
  return v_outcome;
end;
$$;

-- Подводит все завершившиеся периоды: локальный день окончания + grace прошёл
-- и в периоде не осталось отметок на проверке.
create function app_private.settle_due_periods() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_h record;
  v_p record;
  v_count int := 0;
begin
  for v_h in
    select h.id, (app_private.now() at time zone g.timezone)::date as today
      from public.habits h join public.groups g on g.id = h.group_id
     where h.status = 'active' and h.active_from is not null
  loop
    perform app_private.ensure_periods(v_h.id, v_h.today);
  end loop;

  for v_p in
    select p.id
      from public.periods p
      join public.groups g on g.id = p.group_id
     where p.status = 'open'
       and app_private.now() >= (p.period_end::timestamp at time zone g.timezone)
                                + make_interval(mins => coalesce((g.rules ->> 'graceMinutes')::int, 120))
       and not exists (select 1 from public.checkins c
                        where c.habit_id = p.habit_id and c.period_start = p.period_start and c.status = 'pending')
     order by p.period_end
     limit 2000 -- порция за тик; периоды упорядочены, поэтому стрики считаются по порядку
     for update of p skip locked
  loop
    perform app_private.settle_period(v_p.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------- seasons
create function app_private.roll_seasons() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_s record;
  v_count int := 0;
begin
  for v_s in
    select s.*, g.season_days, (app_private.now() at time zone g.timezone)::date as today
      from public.seasons s join public.groups g on g.id = s.group_id
     where s.status = 'active'
       and (app_private.now() at time zone g.timezone)::date >= s.ends_on
     for update of s skip locked
  loop
    update public.seasons set status = 'closed', closed_at = app_private.now() where id = v_s.id;
    insert into public.seasons (group_id, number, starts_on, ends_on)
    values (v_s.group_id, v_s.number + 1, v_s.ends_on, v_s.ends_on + v_s.season_days)
    on conflict (group_id, number) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Хук для итогов сезона (этап 6 заменит).
create function app_private.after_tick() returns jsonb
language sql security definer set search_path = ''
as $$ select '{}'::jsonb; $$;

-- Один «тик» планировщика. Порядок важен: сначала решения по отметкам,
-- потом подведение периодов, потом сезоны.
create function app_private.tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb := '{}';
begin
  v := v || jsonb_build_object('pending_changes', app_private.apply_pending_group_changes());
  v := v || jsonb_build_object('checkins_decided', app_private.decide_due_checkins());
  v := v || jsonb_build_object('periods_settled', app_private.settle_due_periods());
  v := v || jsonb_build_object('seasons_rolled', app_private.roll_seasons());
  v := v || app_private.after_tick();
  return v;
end;
$$;

create function public.run_tick() returns jsonb
language sql security definer set search_path = ''
as $$ select app_private.tick(); $$;

-- pg_cron, если доступен (в Supabase — включите расширение pg_cron в Dashboard).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('orle-tick', '*/5 * * * *', 'select app_private.tick()');
  end if;
exception when others then
  raise notice 'pg_cron unavailable (%), use /api/cron/tick', sqlerrm;
end
$$;

-- ----------------------------------------------------------------- freezes
create function public.declare_freeze(p_group_id uuid, p_starts_on date, p_ends_on date, p_reason text)
returns public.freezes
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_today date;
  v_season public.seasons;
  v_used int;
  v_limit int;
  v_row public.freezes;
begin
  perform app_private.require_member(p_group_id, v_uid);
  v_today := app_private.group_today(p_group_id);
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on or p_ends_on - p_starts_on >= 14 then
    perform app_private.raise_error('invalid_freeze');
  end if;
  -- Только заранее: до начала первого замороженного дня.
  if p_starts_on <= v_today then
    perform app_private.raise_error('freeze_too_late');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    perform app_private.raise_error('comment_required');
  end if;
  select * into v_season from public.seasons where group_id = p_group_id and status = 'active';
  if v_season.id is null or p_starts_on >= v_season.ends_on then
    perform app_private.raise_error('invalid_freeze');
  end if;
  select (scoring_config ->> 'freezesPerSeason')::int into v_limit from public.groups where id = p_group_id;
  select count(*) into v_used from public.freezes where group_id = p_group_id and user_id = v_uid and season_id = v_season.id;
  if v_used >= v_limit then
    perform app_private.raise_error('freeze_limit_reached');
  end if;
  if exists (select 1 from public.freezes where group_id = p_group_id and user_id = v_uid
               and starts_on <= p_ends_on and ends_on >= p_starts_on) then
    perform app_private.raise_error('invalid_freeze');
  end if;
  insert into public.freezes (group_id, user_id, season_id, starts_on, ends_on, reason, created_at)
  values (p_group_id, v_uid, v_season.id, p_starts_on, least(p_ends_on, v_season.ends_on - 1), btrim(p_reason), app_private.now())
  returning * into v_row;
  perform app_private.audit(p_group_id, v_uid, 'freeze_declared', 1::smallint,
    jsonb_build_object('starts_on', p_starts_on, 'ends_on', v_row.ends_on));
  return v_row;
end;
$$;

-- Отменить можно только ещё не начавшуюся заморозку (попытка «сэкономить» её задним числом невозможна).
create function public.cancel_freeze(p_freeze_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_f public.freezes;
begin
  select * into v_f from public.freezes where id = p_freeze_id;
  if v_f.id is null or v_f.user_id <> v_uid then
    perform app_private.raise_error('invalid_freeze');
  end if;
  if v_f.starts_on <= app_private.group_today(v_f.group_id) then
    perform app_private.raise_error('freeze_too_late');
  end if;
  delete from public.freezes where id = p_freeze_id;
end;
$$;

-- ------------------------------------------------------------ leaderboards
-- scope: week | month | season | all. Границы — в часовом поясе группы.
create function public.leaderboard(p_group_id uuid, p_scope text default 'season')
returns table (user_id uuid, points numeric, rank bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_from timestamptz;
  v_season uuid;
begin
  if not app_private.is_member(p_group_id) then
    perform app_private.raise_error('not_a_member');
  end if;
  select timezone into v_tz from public.groups where id = p_group_id;
  v_today := (app_private.now() at time zone v_tz)::date;
  if p_scope = 'week' then
    v_from := date_trunc('week', v_today)::timestamp at time zone v_tz;
  elsif p_scope = 'month' then
    v_from := date_trunc('month', v_today)::timestamp at time zone v_tz;
  elsif p_scope = 'season' then
    select id into v_season from public.seasons where group_id = p_group_id and status = 'active';
  elsif p_scope <> 'all' then
    perform app_private.raise_error('invalid_settings', 'scope');
  end if;

  return query
  select m.user_id, coalesce(sum(l.amount), 0)::numeric as points,
         rank() over (order by coalesce(sum(l.amount), 0) desc)
    from public.group_members m
    left join public.points_ledger l
      on l.group_id = m.group_id and l.user_id = m.user_id
     and (v_from is null or l.created_at >= v_from)
     and (p_scope <> 'season' or l.season_id = v_season)
   where m.group_id = p_group_id
   group by m.user_id
   order by points desc, m.user_id;
end;
$$;

-- Арена: для каждого участника — очки (всего и за сезон), лучший текущий стрик,
-- сделал ли всё на сегодня, заморожен ли, был ли пропуск за последнюю неделю.
create function public.group_arena(p_group_id uuid)
returns table (
  user_id uuid, total_points numeric, season_points numeric, best_streak int,
  today_total int, today_done int, frozen_today boolean, missed_recently boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_season uuid;
begin
  if not app_private.is_member(p_group_id) then
    perform app_private.raise_error('not_a_member');
  end if;
  select timezone into v_tz from public.groups where id = p_group_id;
  v_today := (app_private.now() at time zone v_tz)::date;
  select id into v_season from public.seasons where group_id = p_group_id and status = 'active';

  return query
  with active_h as (
    select h.* from public.habits h
     where h.group_id = p_group_id and h.status = 'active'
       and h.active_from <= v_today and (h.active_until is null or h.active_until > v_today)
  ),
  streaks as (
    select h.user_id, max(app_private.prev_streak(h, v_today + 1)) as s
      from active_h h group by h.user_id
  ),
  today as (
    select h.user_id,
           count(*) filter (where h.frequency = 'daily') as total,
           count(*) filter (where h.frequency = 'daily' and exists (
             select 1 from public.checkins c where c.habit_id = h.id and c.local_date = v_today and c.status <> 'rejected')) as done
      from active_h h group by h.user_id
  )
  select m.user_id,
         coalesce((select sum(amount) from public.points_ledger l where l.group_id = p_group_id and l.user_id = m.user_id), 0),
         coalesce((select sum(amount) from public.points_ledger l where l.group_id = p_group_id and l.user_id = m.user_id and l.season_id = v_season), 0),
         coalesce(s.s, 0)::int,
         coalesce(t.total, 0)::int,
         coalesce(t.done, 0)::int,
         exists (select 1 from public.freezes f where f.group_id = p_group_id and f.user_id = m.user_id and v_today between f.starts_on and f.ends_on),
         exists (select 1 from public.points_ledger l where l.group_id = p_group_id and l.user_id = m.user_id
                   and l.event_type in ('miss_penalty', 'fake_penalty') and l.created_at > app_private.now() - interval '7 days')
    from public.group_members m
    left join streaks s on s.user_id = m.user_id
    left join today t on t.user_id = m.user_id
   where m.group_id = p_group_id;
end;
$$;

grant execute on function public.declare_freeze(uuid, date, date, text) to authenticated;
grant execute on function public.cancel_freeze(uuid) to authenticated;
grant execute on function public.leaderboard(uuid, text) to authenticated;
grant execute on function public.group_arena(uuid) to authenticated;
grant execute on function public.run_tick() to service_role;
