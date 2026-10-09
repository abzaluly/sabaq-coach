-- Orle: «сегодня» — привычки текущего пользователя с прогрессом текущего периода.
-- Отдельная функция, чтобы главная строилась одним запросом по всем группам.

create function public.my_today(p_group_id uuid default null)
returns table (
  habit_id uuid,
  group_id uuid,
  group_name text,
  title text,
  frequency public.habit_frequency,
  target_count smallint,
  proof_type public.proof_type,
  difficulty public.habit_difficulty,
  local_date date,
  period_start date,
  period_end date,
  done_count int,
  pending_count int,
  checked_today boolean,
  frozen_today boolean,
  -- можно ли ещё отметить вчерашний день (grace-окно и слот свободен)
  can_previous_day boolean
)
language sql stable security definer set search_path = ''
as $$
  with me as (select auth.uid() as uid),
  base as (
    select h.*, g.name as group_name, g.rules,
           (app_private.now() at time zone g.timezone) as local_ts
      from public.habits h
      join public.groups g on g.id = h.group_id
      join public.group_members m on m.group_id = h.group_id and m.user_id = (select uid from me)
     where h.user_id = (select uid from me)
       and h.status = 'active'
       and (p_group_id is null or h.group_id = p_group_id)
  ),
  cur as (
    select b.*, b.local_ts::date as today, pb.period_start as p_start, pb.period_end as p_end
      from base b, app_private.period_bounds(b.frequency, b.local_ts::date) pb
     where b.active_from <= pb.period_start
       and (b.active_until is null or pb.period_start < b.active_until)
  )
  select c.id, c.group_id, c.group_name, c.title, c.frequency, c.target_count, c.proof_type, c.difficulty,
         c.today, c.p_start, c.p_end,
         (select count(*)::int from public.checkins k
           where k.habit_id = c.id and k.period_start = c.p_start and k.status <> 'rejected'),
         (select count(*)::int from public.checkins k
           where k.habit_id = c.id and k.period_start = c.p_start and k.status = 'pending'),
         exists (select 1 from public.checkins k where k.habit_id = c.id and k.local_date = c.today and k.status <> 'rejected'),
         exists (select 1 from public.freezes f where f.group_id = c.group_id and f.user_id = c.user_id
                   and c.today between f.starts_on and f.ends_on),
         (c.local_ts - c.today::timestamp) < make_interval(mins => coalesce((c.rules ->> 'graceMinutes')::int, 120))
           and not exists (select 1 from public.checkins k where k.habit_id = c.id and k.local_date = c.today - 1 and k.status <> 'rejected')
           and not exists (select 1 from public.freezes f where f.group_id = c.group_id and f.user_id = c.user_id
                             and c.today - 1 between f.starts_on and f.ends_on)
           and exists (
             select 1 from app_private.period_bounds(c.frequency, c.today - 1) yb
              where c.active_from <= yb.period_start
                and not exists (select 1 from public.periods p where p.habit_id = c.id and p.period_start = yb.period_start and p.status = 'settled')
                and (select count(*) from public.checkins k
                      where k.habit_id = c.id and k.period_start = yb.period_start and k.status <> 'rejected') < c.target_count
           )
    from cur c
   order by c.group_name, c.created_at;
$$;

grant execute on function public.my_today(uuid) to authenticated;
