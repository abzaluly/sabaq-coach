-- Orle, этап 7: дополнительные ограничения по итогам аудита.

-- Не больше 30 голосов в минуту от одного участника (защита от скриптов).
create function app_private.limit_votes() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.checkin_votes
       where voter_id = new.voter_id and created_at > app_private.now() - interval '1 minute') >= 30 then
    perform app_private.raise_error('rate_limited');
  end if;
  return new;
end;
$$;

create trigger checkin_votes_rate_limit before insert on public.checkin_votes
  for each row execute function app_private.limit_votes();

-- Индексы под частые запросы (по результатам EXPLAIN ANALYZE, см. scripts/load-test.mjs).
create index if not exists checkins_habit_period_idx on public.checkins (habit_id, period_start, status);
create index if not exists checkin_votes_checkin_idx on public.checkin_votes (checkin_id);
create index if not exists points_ledger_season_idx on public.points_ledger (season_id, user_id);
create index if not exists freezes_user_dates_idx on public.freezes (user_id, group_id, starts_on, ends_on);
create index if not exists periods_habit_status_idx on public.periods (habit_id, status, period_start desc);
-- settle_period и отзыв очков суммируют журнал по отметке — без индекса это полный скан.
create index if not exists points_ledger_checkin_idx on public.points_ledger (checkin_id) where checkin_id is not null;
create index if not exists points_ledger_period_idx on public.points_ledger (period_id) where period_id is not null;

-- Удаление аккаунта или группы каскадно удаляет их журнал (право на удаление данных).
-- Прямые UPDATE/DELETE журнала по-прежнему запрещены: каскад внешнего ключа выполняется
-- внутренним RI-триггером, поэтому наш триггер видит pg_trigger_depth() > 1.
create or replace function app_private.ledger_is_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op <> 'TRUNCATE' and pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'points_ledger is append-only' using errcode = '42501';
end;
$$;

-- Удаление аккаунта не должно блокироваться ссылками «кто создал/кто разобрал».
alter table public.groups alter column created_by drop not null;
alter table public.groups drop constraint groups_created_by_fkey,
  add constraint groups_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;
alter table public.invites drop constraint invites_created_by_fkey,
  add constraint invites_created_by_fkey foreign key (created_by) references public.profiles (id) on delete cascade;
alter table public.audit_log drop constraint audit_log_resolved_by_fkey,
  add constraint audit_log_resolved_by_fkey foreign key (resolved_by) references public.profiles (id) on delete set null;

-- Если владелец удалил аккаунт — владение переходит самому давнему админу, иначе участнику.
create function app_private.reassign_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'owner' and not exists (select 1 from public.group_members where group_id = old.group_id and role = 'owner') then
    update public.group_members set role = 'owner'
     where (group_id, user_id) = (
       select group_id, user_id from public.group_members where group_id = old.group_id
        order by (role = 'admin') desc, joined_at limit 1);
  end if;
  return null;
end;
$$;

create trigger group_members_reassign_owner after delete on public.group_members
  for each row execute function app_private.reassign_owner();
