-- Orle, этап 5: достижения, косметика, сводка для главной.
-- Достижения выдаёт только сервер — триггерами на подведённые периоды, решения по
-- отметкам и закрытие сезонов.

-- Каталог: каждое достижение открывает косметику.
insert into public.cosmetics (code, kind, sort_order) values
  ('frame_ember', 'frame', 10),
  ('frame_gold', 'frame', 20),
  ('bg_meadow', 'background', 10),
  ('bg_aurora', 'background', 20),
  ('acc_scarf', 'accessory', 10),
  ('acc_crown', 'accessory', 20),
  ('acc_gavel', 'accessory', 30)
on conflict do nothing;

insert into public.achievements (code, cosmetic_code, sort_order) values
  ('streak_7', 'frame_ember', 10),
  ('streak_30', 'bg_aurora', 20),
  ('streak_100', 'frame_gold', 30),
  ('first_full_week', 'acc_scarf', 40),
  ('honest_judge', 'acc_gavel', 50),
  ('season_winner', 'acc_crown', 60)
on conflict do nothing;


create function app_private.award(p_user_id uuid, p_group_id uuid, p_code text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.user_achievements (user_id, group_id, achievement_code, earned_at)
  select p_user_id, p_group_id, p_code, app_private.now()
   where exists (select 1 from public.achievements where code = p_code)
  on conflict do nothing;
$$;

-- Стрики 7/30/100 дней (ежедневные привычки) и первая полностью выполненная неделя.
create function app_private.achievements_on_period() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_h public.habits;
  v_week_start date;
begin
  if new.status <> 'settled' or old.status = 'settled' or new.streak_after is null then
    return new;
  end if;
  select * into v_h from public.habits where id = new.habit_id;

  if v_h.frequency = 'daily' then
    if new.streak_after >= 7 then perform app_private.award(new.user_id, new.group_id, 'streak_7'); end if;
    if new.streak_after >= 30 then perform app_private.award(new.user_id, new.group_id, 'streak_30'); end if;
    if new.streak_after >= 100 then perform app_private.award(new.user_id, new.group_id, 'streak_100'); end if;
    -- Воскресенье: все ежедневные привычки выполнены все 7 дней ISO-недели.
    if extract(isodow from new.period_start) = 7 then
      v_week_start := new.period_start - 6;
      if not exists (
        select 1 from public.periods p join public.habits h on h.id = p.habit_id
         where p.group_id = new.group_id and p.user_id = new.user_id and h.frequency = 'daily'
           and p.period_start between v_week_start and new.period_start
           and (p.status <> 'settled' or p.done_count < p.required_count)
      ) and (
        select count(*) from public.periods p join public.habits h on h.id = p.habit_id
         where p.group_id = new.group_id and p.user_id = new.user_id and h.frequency = 'daily'
           and p.period_start between v_week_start and new.period_start
      ) >= 7 then
        perform app_private.award(new.user_id, new.group_id, 'first_full_week');
      end if;
    end if;
  elsif v_h.frequency = 'weekly' and new.required_count > 0 and new.done_count >= new.required_count then
    perform app_private.award(new.user_id, new.group_id, 'first_full_week');
  end if;
  return new;
end;
$$;

create trigger periods_achievements after update of status on public.periods
  for each row execute function app_private.achievements_on_period();

-- «Честный судья»: 10 голосов, совпавших с итоговым решением, из них хотя бы один спор.
create function app_private.achievements_on_decision() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_voter uuid;
begin
  if new.status = old.status or new.status = 'pending' then
    return new;
  end if;
  for v_voter in select voter_id from public.checkin_votes where checkin_id = new.id loop
    if (
      select count(*) filter (where (cv.vote = 'confirm' and c.status = 'approved') or (cv.vote = 'dispute' and c.status = 'rejected')) >= 10
         and count(*) filter (where cv.vote = 'dispute' and c.status = 'rejected') >= 1
        from public.checkin_votes cv join public.checkins c on c.id = cv.checkin_id
       where cv.voter_id = v_voter and cv.group_id = new.group_id
    ) then
      perform app_private.award(v_voter, new.group_id, 'honest_judge');
    end if;
  end loop;
  return new;
end;
$$;

create trigger checkins_achievements after update of status on public.checkins
  for each row execute function app_private.achievements_on_decision();

-- Победитель сезона — первое место с положительным счётом.
create function app_private.achievements_on_season() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_winner uuid;
begin
  if new.status <> 'closed' or old.status = 'closed' then
    return new;
  end if;
  select l.user_id into v_winner
    from public.points_ledger l
    join public.group_members m on m.group_id = l.group_id and m.user_id = l.user_id
   where l.season_id = new.id
   group by l.user_id
  having sum(l.amount) > 0
   order by sum(l.amount) desc, l.user_id
   limit 1;
  if v_winner is not null then
    perform app_private.award(v_winner, new.group_id, 'season_winner');
  end if;
  return new;
end;
$$;

create trigger seasons_achievements after update of status on public.seasons
  for each row execute function app_private.achievements_on_season();

-- Надеть косметику можно только открытую достижением (в любой из своих групп).
create function public.equip_cosmetic(p_kind public.cosmetic_kind, p_code text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
begin
  if p_code is null then
    delete from public.equipped_cosmetics where user_id = v_uid and kind = p_kind;
    return;
  end if;
  if not exists (
    select 1 from public.cosmetics c
      join public.achievements a on a.cosmetic_code = c.code
      join public.user_achievements ua on ua.achievement_code = a.code and ua.user_id = v_uid
     where c.code = p_code and c.kind = p_kind
  ) then
    perform app_private.raise_error('cosmetic_locked');
  end if;
  insert into public.equipped_cosmetics (user_id, kind, cosmetic_code) values (v_uid, p_kind, p_code)
  on conflict (user_id, kind) do update set cosmetic_code = excluded.cosmetic_code;
end;
$$;

-- Сводка по моим группам для главной: очки и лучший текущий стрик.
create function public.my_summary()
returns table (group_id uuid, total_points numeric, best_streak int)
language sql stable security definer set search_path = ''
as $$
  select m.group_id,
         coalesce((select sum(amount) from public.points_ledger l where l.group_id = m.group_id and l.user_id = m.user_id), 0),
         coalesce((
           select max(app_private.prev_streak(h, (app_private.now() at time zone g.timezone)::date + 1))
             from public.habits h
            where h.group_id = m.group_id and h.user_id = m.user_id and h.status = 'active'
         ), 0)::int
    from public.group_members m join public.groups g on g.id = m.group_id
   where m.user_id = auth.uid();
$$;

grant execute on function public.equip_cosmetic(public.cosmetic_kind, text) to authenticated;
grant execute on function public.my_summary() to authenticated;
