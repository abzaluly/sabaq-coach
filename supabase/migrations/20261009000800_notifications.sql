-- Orle, этап 6: уведомления (очередь), итоги сезона.
--
-- БД только решает, КОМУ и ЧТО отправить, и складывает это в notification_outbox
-- (с ключом дедупликации). Отправку (web-push, email) делает /api/cron/tick.

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  kind text not null check (kind in ('evening_reminder', 'checkin_disputed', 'weekly_digest', 'season_results')),
  payload jsonb not null default '{}',
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  error text
);
create index notification_outbox_pending_idx on public.notification_outbox (created_at) where sent_at is null;
alter table public.notification_outbox enable row level security;
-- Клиенту очередь не видна вовсе (нет ни прав, ни политик).
revoke all on public.notification_outbox from anon, authenticated;

create function app_private.enqueue(p_user uuid, p_group uuid, p_kind text, p_key text, p_payload jsonb) returns void
language sql security definer set search_path = ''
as $$
  insert into public.notification_outbox (user_id, group_id, kind, dedupe_key, payload, created_at)
  values (p_user, p_group, p_kind, p_key, coalesce(p_payload, '{}'), app_private.now())
  on conflict (dedupe_key) do nothing;
$$;

-- Отметку оспорили → уведомление автору (один раз на спорщика и отметку).
create function app_private.notify_dispute() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.checkins;
begin
  if new.vote <> 'dispute' then
    return new;
  end if;
  select * into v_c from public.checkins where id = new.checkin_id;
  perform app_private.enqueue(v_c.user_id, v_c.group_id, 'checkin_disputed', 'dispute:' || new.checkin_id || ':' || new.voter_id,
    jsonb_build_object('checkin_id', v_c.id, 'habit_id', v_c.habit_id, 'voter_id', new.voter_id, 'comment', new.comment));
  return new;
end;
$$;

create trigger checkin_votes_notify after insert or update of vote on public.checkin_votes
  for each row execute function app_private.notify_dispute();

-- Вечернее напоминание: после reminder_time по часовому поясу группы, если сегодня
-- ещё есть неотмеченные ежедневные привычки (или незакрытые «N раз» в последний день периода).
create function app_private.enqueue_reminders() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  with candidates as (
    select h.user_id, h.group_id, g.name as group_name, (app_private.now() at time zone g.timezone) as local_ts,
           count(*) as open_habits
      from public.habits h
      join public.groups g on g.id = h.group_id
      join public.notification_prefs np on np.user_id = h.user_id
      cross join lateral app_private.period_bounds(h.frequency, (app_private.now() at time zone g.timezone)::date) pb
     where h.status = 'active'
       and np.evening_reminder
       and h.active_from <= (app_private.now() at time zone g.timezone)::date
       and (h.active_until is null or h.active_until > (app_private.now() at time zone g.timezone)::date)
       and (app_private.now() at time zone g.timezone)::time >= np.reminder_time
       and not exists (select 1 from public.freezes f where f.group_id = h.group_id and f.user_id = h.user_id
                         and (app_private.now() at time zone g.timezone)::date between f.starts_on and f.ends_on)
       and (
         -- ежедневная не отмечена сегодня
         (h.frequency = 'daily' and not exists (
            select 1 from public.checkins c where c.habit_id = h.id
               and c.local_date = (app_private.now() at time zone g.timezone)::date and c.status <> 'rejected'))
         or
         -- «N раз»: последний день периода, а нужное число не набрано
         (h.frequency <> 'daily' and pb.period_end - 1 = (app_private.now() at time zone g.timezone)::date
          and (select count(*) from public.checkins c where c.habit_id = h.id and c.period_start = pb.period_start
                 and c.status <> 'rejected') < h.target_count)
       )
     group by h.user_id, h.group_id, g.name, g.timezone
  ), inserted as (
    insert into public.notification_outbox (user_id, group_id, kind, dedupe_key, payload, created_at)
    select user_id, group_id, 'evening_reminder',
           'reminder:' || user_id || ':' || group_id || ':' || local_ts::date,
           jsonb_build_object('group_name', group_name, 'open_habits', open_habits),
           app_private.now()
      from candidates
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

-- Итоги недели: в понедельник после 9:00 по времени группы — очки за прошлую неделю и место.
create function app_private.enqueue_weekly_digests() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_g record;
  v_count int := 0;
  v_from timestamptz;
  v_to timestamptz;
  v_n int;
begin
  for v_g in
    select g.id, g.name, g.timezone, (app_private.now() at time zone g.timezone) as local_ts
      from public.groups g
     where extract(isodow from (app_private.now() at time zone g.timezone)) = 1
       and (app_private.now() at time zone g.timezone)::time >= '09:00'
  loop
    v_to := date_trunc('week', v_g.local_ts)::timestamp at time zone v_g.timezone;
    v_from := v_to - interval '7 days';
    with scores as (
      select m.user_id, coalesce(sum(l.amount), 0) as points
        from public.group_members m
        left join public.points_ledger l on l.group_id = m.group_id and l.user_id = m.user_id
             and l.created_at >= v_from and l.created_at < v_to
       where m.group_id = v_g.id
       group by m.user_id
    ), ranked as (
      select user_id, points, rank() over (order by points desc) as rnk, count(*) over () as total from scores
    ), ins as (
      insert into public.notification_outbox (user_id, group_id, kind, dedupe_key, payload, created_at)
      select r.user_id, v_g.id, 'weekly_digest', 'digest:' || r.user_id || ':' || v_g.id || ':' || v_to::date,
             jsonb_build_object('group_name', v_g.name, 'points', r.points, 'rank', r.rnk, 'members', r.total,
                                'leader_points', (select max(points) from scores)),
             app_private.now()
        from ranked r join public.notification_prefs np on np.user_id = r.user_id and np.weekly_digest
      on conflict (dedupe_key) do nothing
      returning 1
    )
    select count(*) into v_n from ins;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;

-- ------------------------------------------------------------- итоги сезона
create function public.season_results(p_season_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_s public.seasons;
  v_result jsonb;
begin
  select * into v_s from public.seasons where id = p_season_id;
  if v_s.id is null or not app_private.is_member(v_s.group_id) then
    perform app_private.raise_error('not_a_member');
  end if;
  select jsonb_build_object(
    'season', jsonb_build_object('id', v_s.id, 'number', v_s.number, 'starts_on', v_s.starts_on, 'ends_on', v_s.ends_on, 'status', v_s.status),
    'standings', coalesce((
      select jsonb_agg(x order by x.points desc, x.user_id) from (
        select m.user_id, coalesce(sum(l.amount), 0) as points,
               count(*) filter (where l.event_type = 'checkin') as checkins,
               count(*) filter (where l.event_type in ('miss_penalty')) as misses,
               count(*) filter (where l.event_type in ('fake_penalty')) as fakes
          from public.group_members m
          left join public.points_ledger l on l.group_id = m.group_id and l.user_id = m.user_id and l.season_id = v_s.id
         where m.group_id = v_s.group_id
         group by m.user_id) x), '[]'),
    'best_streaks', coalesce((
      select jsonb_agg(x order by x.streak desc) from (
        select p.user_id, max(p.streak_after) as streak
          from public.periods p
         where p.group_id = v_s.group_id and p.period_start >= v_s.starts_on and p.period_start < v_s.ends_on
           and p.streak_after > 0
         group by p.user_id
         order by streak desc limit 3) x), '[]'),
    'judges', coalesce((
      select jsonb_agg(x order by x.correct desc) from (
        select cv.voter_id as user_id,
               count(*) filter (where (cv.vote = 'confirm' and c.status = 'approved') or (cv.vote = 'dispute' and c.status = 'rejected')) as correct,
               count(*) filter (where cv.vote = 'dispute' and c.status = 'rejected') as caught
          from public.checkin_votes cv join public.checkins c on c.id = cv.checkin_id
         where cv.group_id = v_s.group_id and c.local_date >= v_s.starts_on and c.local_date < v_s.ends_on
         group by cv.voter_id
         order by correct desc, caught desc limit 3) x), '[]')
  ) into v_result;
  return v_result;
end;
$$;

-- При закрытии сезона — уведомление всем участникам.
create or replace function app_private.after_tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_s record;
begin
  for v_s in
    select s.id, s.group_id, s.number, g.name from public.seasons s join public.groups g on g.id = s.group_id
     where s.status = 'closed' and s.closed_at > app_private.now() - interval '1 day'
  loop
    insert into public.notification_outbox (user_id, group_id, kind, dedupe_key, payload, created_at)
    select m.user_id, v_s.group_id, 'season_results', 'season:' || v_s.id || ':' || m.user_id,
           jsonb_build_object('group_name', v_s.name, 'season_id', v_s.id, 'number', v_s.number), app_private.now()
      from public.group_members m where m.group_id = v_s.group_id
    on conflict (dedupe_key) do nothing;
  end loop;
  return jsonb_build_object(
    'reminders', app_private.enqueue_reminders(),
    'digests', app_private.enqueue_weekly_digests());
end;
$$;

-- Сервер забирает пачку на отправку (с блокировкой, чтобы параллельные крон-вызовы не дублировали).
create function public.claim_notifications(p_limit int default 200)
returns table (id bigint, user_id uuid, group_id uuid, kind text, payload jsonb, email text,
               via_push boolean, via_email boolean, wants boolean)
language sql security definer set search_path = ''
as $$
  with picked as (
    select o.id from public.notification_outbox o
     where o.sent_at is null and (o.claimed_at is null or o.claimed_at < app_private.now() - interval '10 minutes')
     order by o.created_at
     limit p_limit
     for update skip locked
  ), upd as (
    update public.notification_outbox o set claimed_at = app_private.now()
      from picked where o.id = picked.id
    returning o.*
  )
  select u.id, u.user_id, u.group_id, u.kind, u.payload, au.email::text,
         coalesce(np.via_push, true), coalesce(np.via_email, true),
         case u.kind
           when 'checkin_disputed' then coalesce(np.checkin_disputed, true)
           when 'weekly_digest' then coalesce(np.weekly_digest, true)
           when 'evening_reminder' then coalesce(np.evening_reminder, true)
           else true end
    from upd u
    join auth.users au on au.id = u.user_id
    left join public.notification_prefs np on np.user_id = u.user_id;
$$;

create function public.complete_notification(p_id bigint, p_error text default null) returns void
language sql security definer set search_path = ''
as $$
  update public.notification_outbox set sent_at = app_private.now(), error = p_error where id = p_id;
$$;

grant execute on function public.season_results(uuid) to authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.complete_notification(bigint, text) to service_role;

-- service_role (только сервер) читает и пишет таблицы напрямую — в Supabase это право
-- выдаётся по умолчанию, здесь фиксируем явно (в т.ч. для локального стека без Docker).
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
