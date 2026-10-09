-- Orle, этап 2: группы, инвайты, роли, привычки и их одобрение группой.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- helpers
create function app_private.group_today(p_group_id uuid) returns date
language sql stable security definer set search_path = ''
as $$
  select (app_private.now() at time zone g.timezone)::date from public.groups g where g.id = p_group_id;
$$;

create function app_private.require_member(p_group_id uuid, p_uid uuid) returns public.group_role
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.group_role;
begin
  select role into v_role from public.group_members where group_id = p_group_id and user_id = p_uid;
  if v_role is null then
    perform app_private.raise_error('not_a_member');
  end if;
  return v_role;
end;
$$;

create function app_private.require_admin(p_group_id uuid, p_uid uuid) returns public.group_role
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.group_role := app_private.require_member(p_group_id, p_uid);
begin
  if v_role not in ('owner', 'admin') then
    perform app_private.raise_error('admin_only');
  end if;
  return v_role;
end;
$$;

create function app_private.valid_timezone(p_tz text) returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

-- Проверяет и нормализует пользовательские правила/коэффициенты:
-- только известные ключи, только числа в разумных пределах.
create function app_private.merge_rules(p_current jsonb, p_patch jsonb) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_result jsonb := app_private.default_rules() || coalesce(p_current, '{}');
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_limits jsonb := '{
    "habitApprovalVotes": [1, 20], "maxActiveHabits": [1, 10], "graceMinutes": [0, 360],
    "reviewWindowHours": [1, 72], "confirmationsToApprove": [1, 10],
    "collusionWindowDays": [1, 90], "checkinsPerMinute": [1, 30]
  }';
begin
  for v_key, v_val in select * from jsonb_each(coalesce(p_patch, '{}')) loop
    if v_key = 'habitApproval' then
      if v_val #>> '{}' not in ('majority', 'count') then
        perform app_private.raise_error('invalid_settings', v_key);
      end if;
    elsif v_limits ? v_key then
      if jsonb_typeof(v_val) <> 'number' then
        perform app_private.raise_error('invalid_settings', v_key);
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num <> trunc(v_num)
         or v_num < (v_limits -> v_key ->> 0)::numeric
         or v_num > (v_limits -> v_key ->> 1)::numeric then
        perform app_private.raise_error('invalid_settings', v_key);
      end if;
    else
      perform app_private.raise_error('invalid_settings', v_key);
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_val);
  end loop;
  return v_result;
end;
$$;

create function app_private.merge_scoring(p_current jsonb, p_patch jsonb) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_result jsonb := app_private.default_scoring_config() || coalesce(p_current, '{}');
  v_key text;
  v_val jsonb;
  v_sub text;
  v_num numeric;
  v_limits jsonb := '{
    "honorMultiplier": [0, 1], "fullPeriodBonus": [0, 1], "streakStep": [0, 0.5],
    "streakMaxMultiplier": [1, 5], "missPenalty": [0, 2], "fakePenaltyMultiplier": [0, 10],
    "freezesPerSeason": [0, 10]
  }';
begin
  for v_key, v_val in select * from jsonb_each(coalesce(p_patch, '{}')) loop
    if v_key in ('base', 'difficulty') then
      if jsonb_typeof(v_val) <> 'object' then
        perform app_private.raise_error('invalid_settings', v_key);
      end if;
      for v_sub in select jsonb_object_keys(v_val) loop
        if not (v_result -> v_key) ? v_sub or jsonb_typeof(v_val -> v_sub) <> 'number' then
          perform app_private.raise_error('invalid_settings', v_key || '.' || v_sub);
        end if;
        v_num := (v_val ->> v_sub)::numeric;
        if v_num <= 0 or v_num > 1000 then
          perform app_private.raise_error('invalid_settings', v_key || '.' || v_sub);
        end if;
      end loop;
      v_result := jsonb_set(v_result, array[v_key], (v_result -> v_key) || v_val);
    elsif v_limits ? v_key then
      if jsonb_typeof(v_val) <> 'number' then
        perform app_private.raise_error('invalid_settings', v_key);
      end if;
      v_num := (v_val #>> '{}')::numeric;
      if v_num < (v_limits -> v_key ->> 0)::numeric or v_num > (v_limits -> v_key ->> 1)::numeric then
        perform app_private.raise_error('invalid_settings', v_key);
      end if;
      v_result := v_result || jsonb_build_object(v_key, v_val);
    else
      perform app_private.raise_error('invalid_settings', v_key);
    end if;
  end loop;
  return v_result;
end;
$$;

-- Применяет отложенные изменения таймзоны/правил/очков, когда наступил их день.
create function app_private.apply_pending_group_changes() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int;
begin
  update public.groups g
     set timezone = coalesce(g.pending_changes ->> 'timezone', g.timezone),
         rules = coalesce(g.pending_changes -> 'rules', g.rules),
         scoring_config = coalesce(g.pending_changes -> 'scoring_config', g.scoring_config),
         pending_changes = null,
         pending_effective_from = null
   where g.pending_changes is not null
     and g.pending_effective_from <= (app_private.now() at time zone g.timezone)::date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------- groups
create function public.create_group(
  p_name text,
  p_timezone text default 'Asia/Almaty',
  p_season_days int default 30,
  p_max_members int default 12
) returns public.groups
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_group public.groups;
  v_today date;
  v_owned int;
begin
  if not exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    perform app_private.raise_error('onboarding_required');
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    perform app_private.raise_error('invalid_group_name');
  end if;
  if not app_private.valid_timezone(p_timezone) then
    perform app_private.raise_error('invalid_timezone');
  end if;
  if p_season_days not between 7 and 365 or p_max_members not between 2 and 50 then
    perform app_private.raise_error('invalid_settings');
  end if;
  select count(*) into v_owned from public.group_members where user_id = v_uid and role = 'owner';
  if v_owned >= 10 then
    perform app_private.raise_error('too_many_groups');
  end if;

  insert into public.groups (name, timezone, season_days, max_members, created_by)
  values (btrim(p_name), p_timezone, p_season_days, p_max_members, v_uid)
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role) values (v_group.id, v_uid, 'owner');

  v_today := (app_private.now() at time zone p_timezone)::date;
  insert into public.seasons (group_id, number, starts_on, ends_on)
  values (v_group.id, 1, v_today, v_today + p_season_days);

  return v_group;
end;
$$;

-- Название/аватар/лимит участников меняются сразу; таймзона, правила и
-- коэффициенты — со следующего локального дня, чтобы не задеть текущий период.
create function public.update_group_settings(
  p_group_id uuid,
  p_name text default null,
  p_avatar_url text default null,
  p_max_members int default null,
  p_season_days int default null,
  p_timezone text default null,
  p_rules jsonb default null,
  p_scoring jsonb default null
) returns public.groups
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_group public.groups;
  v_members int;
  v_pending jsonb;
begin
  perform app_private.require_admin(p_group_id, v_uid);
  select * into v_group from public.groups where id = p_group_id for update;

  if p_name is not null and char_length(btrim(p_name)) not between 1 and 60 then
    perform app_private.raise_error('invalid_group_name');
  end if;
  if p_avatar_url is not null and p_avatar_url !~ '^https://' then
    perform app_private.raise_error('invalid_settings', 'avatar_url');
  end if;
  if p_max_members is not null then
    select count(*) into v_members from public.group_members where group_id = p_group_id;
    if p_max_members not between greatest(2, v_members) and 50 then
      perform app_private.raise_error('invalid_settings', 'max_members');
    end if;
  end if;
  if p_season_days is not null and p_season_days not between 7 and 365 then
    perform app_private.raise_error('invalid_settings', 'season_days');
  end if;
  if p_timezone is not null and not app_private.valid_timezone(p_timezone) then
    perform app_private.raise_error('invalid_timezone');
  end if;

  v_pending := coalesce(v_group.pending_changes, '{}');
  if p_timezone is not null then
    v_pending := v_pending || jsonb_build_object('timezone', p_timezone);
  end if;
  if p_rules is not null then
    v_pending := v_pending || jsonb_build_object(
      'rules', app_private.merge_rules(coalesce(v_pending -> 'rules', v_group.rules), p_rules));
  end if;
  if p_scoring is not null then
    v_pending := v_pending || jsonb_build_object(
      'scoring_config', app_private.merge_scoring(coalesce(v_pending -> 'scoring_config', v_group.scoring_config), p_scoring));
  end if;

  -- Значения, совпадающие с текущими, не считаются изменением.
  if v_pending ->> 'timezone' = v_group.timezone then v_pending := v_pending - 'timezone'; end if;
  if v_pending -> 'rules' = v_group.rules then v_pending := v_pending - 'rules'; end if;
  if v_pending -> 'scoring_config' = v_group.scoring_config then v_pending := v_pending - 'scoring_config'; end if;

  update public.groups
     set name = coalesce(btrim(p_name), name),
         avatar_url = coalesce(p_avatar_url, avatar_url),
         max_members = coalesce(p_max_members, max_members),
         -- Длительность действует со следующего сезона.
         season_days = coalesce(p_season_days, season_days),
         pending_changes = nullif(v_pending, '{}'),
         pending_effective_from = case when v_pending = '{}' then null
                                       else (app_private.now() at time zone timezone)::date + 1 end
   where id = p_group_id
  returning * into v_group;

  perform app_private.audit(p_group_id, v_uid, 'group_settings_changed', 1::smallint,
    jsonb_build_object('pending', v_pending, 'name', p_name, 'max_members', p_max_members));
  return v_group;
end;
$$;

-- ---------------------------------------------------------------- invites
create function public.create_invite(
  p_group_id uuid, p_expires_hours int default 168, p_max_uses int default null
) returns public.invites
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_invite public.invites;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_bytes bytea;
begin
  perform app_private.require_admin(p_group_id, v_uid);
  if p_expires_hours is not null and p_expires_hours not between 1 and 720 then
    perform app_private.raise_error('invalid_settings', 'expires_hours');
  end if;
  if p_max_uses is not null and p_max_uses not between 1 and 50 then
    perform app_private.raise_error('invalid_settings', 'max_uses');
  end if;
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.invites (group_id, code, created_by, expires_at, max_uses)
      values (p_group_id, v_code, v_uid,
              case when p_expires_hours is null then null else app_private.now() + make_interval(hours => p_expires_hours) end,
              p_max_uses)
      returning * into v_invite;
      exit;
    exception when unique_violation then
      -- крайне маловероятная коллизия — пробуем ещё раз
    end;
  end loop;
  return v_invite;
end;
$$;

create function public.revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_group_id uuid;
begin
  select group_id into v_group_id from public.invites where id = p_invite_id;
  if v_group_id is null then
    perform app_private.raise_error('invite_not_found');
  end if;
  perform app_private.require_admin(v_group_id, v_uid);
  update public.invites set revoked_at = coalesce(revoked_at, app_private.now()) where id = p_invite_id;
end;
$$;

-- Предпросмотр группы по коду для экрана вступления (без доступа к данным группы).
create function public.invite_preview(p_code text)
returns table (group_id uuid, group_name text, member_count int, max_members int, already_member boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
begin
  return query
  select g.id, g.name,
         (select count(*)::int from public.group_members m where m.group_id = g.id),
         g.max_members,
         exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid)
    from public.invites i
    join public.groups g on g.id = i.group_id
   where i.code = upper(btrim(p_code))
     and i.revoked_at is null
     and (i.expires_at is null or i.expires_at > app_private.now())
     and (i.max_uses is null or i.uses < i.max_uses);
end;
$$;

create function public.join_group(p_code text) returns public.group_members
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_invite public.invites;
  v_group public.groups;
  v_count int;
  v_member public.group_members;
begin
  if not exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    perform app_private.raise_error('onboarding_required');
  end if;
  select * into v_invite from public.invites where code = upper(btrim(coalesce(p_code, ''))) for update;
  if v_invite.id is null
     or v_invite.revoked_at is not null
     or (v_invite.expires_at is not null and v_invite.expires_at <= app_private.now())
     or (v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses) then
    perform app_private.raise_error('invite_invalid');
  end if;
  select * into v_group from public.groups where id = v_invite.group_id for update;
  if exists (select 1 from public.group_members where group_id = v_group.id and user_id = v_uid) then
    perform app_private.raise_error('already_member');
  end if;
  select count(*) into v_count from public.group_members where group_id = v_group.id;
  if v_count >= v_group.max_members then
    perform app_private.raise_error('group_full');
  end if;

  insert into public.group_members (group_id, user_id, role) values (v_group.id, v_uid, 'member')
  returning * into v_member;
  update public.invites set uses = uses + 1 where id = v_invite.id;
  return v_member;
end;
$$;

create function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role public.group_role) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
begin
  if app_private.require_member(p_group_id, v_uid) <> 'owner' then
    perform app_private.raise_error('owner_only');
  end if;
  if p_user_id = v_uid then
    perform app_private.raise_error('invalid_settings', 'self');
  end if;
  perform app_private.require_member(p_group_id, p_user_id);
  if p_role = 'owner' then
    -- Передача владения: текущий owner становится admin.
    update public.group_members set role = 'admin' where group_id = p_group_id and user_id = v_uid;
  end if;
  update public.group_members set role = p_role where group_id = p_group_id and user_id = p_user_id;
  perform app_private.audit(p_group_id, v_uid, 'role_changed', 1::smallint,
    jsonb_build_object('user_id', p_user_id, 'role', p_role));
end;
$$;

-- Привычки ушедшего участника архивируются; очки и история остаются в журнале.
create function app_private.detach_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.habits set status = 'archived', decided_at = coalesce(decided_at, app_private.now())
   where group_id = p_group_id and user_id = p_user_id and status in ('proposed', 'active');
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create function public.remove_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_my_role public.group_role := app_private.require_admin(p_group_id, v_uid);
  v_their_role public.group_role := app_private.require_member(p_group_id, p_user_id);
begin
  if p_user_id = v_uid or v_their_role = 'owner' or (v_their_role = 'admin' and v_my_role <> 'owner') then
    perform app_private.raise_error('owner_only');
  end if;
  perform app_private.audit(p_group_id, v_uid, 'member_removed', 2::smallint, jsonb_build_object('user_id', p_user_id));
  perform app_private.detach_member(p_group_id, p_user_id);
end;
$$;

create function public.leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
begin
  if app_private.require_member(p_group_id, v_uid) = 'owner' then
    perform app_private.raise_error('owner_must_transfer');
  end if;
  perform app_private.detach_member(p_group_id, v_uid);
end;
$$;

-- Хабиты/голоса ссылаются на group_members каскадно; чтобы история не терялась
-- при выходе участника, ослабляем FK привычек до ссылок на группу и профиль.
alter table public.habits drop constraint habits_group_id_user_id_fkey;
alter table public.habits
  add constraint habits_group_fk foreign key (group_id) references public.groups (id) on delete cascade,
  add constraint habits_user_fk foreign key (user_id) references public.profiles (id) on delete cascade;

-- ----------------------------------------------------------------- habits
-- Начало первого периода новой/изменённой привычки: текущий период, если он
-- начался сегодня (по часовому поясу группы), иначе — следующий.
create function app_private.first_period_start(p_frequency public.habit_frequency, p_today date) returns date
language sql immutable set search_path = ''
as $$
  select case when b.period_start = p_today then b.period_start else b.period_end end
    from app_private.period_bounds(p_frequency, p_today) b;
$$;

create function app_private.validate_habit(
  p_title text, p_description text, p_frequency public.habit_frequency, p_target int
) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 80 then
    perform app_private.raise_error('invalid_habit_title');
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 10 and 500 then
    perform app_private.raise_error('invalid_habit_description');
  end if;
  if not (
    (p_frequency = 'daily' and p_target = 1)
    or (p_frequency = 'weekly' and p_target between 1 and 7)
    or (p_frequency = 'monthly' and p_target between 1 and 28)
  ) then
    perform app_private.raise_error('invalid_habit_target');
  end if;
end;
$$;

-- Решает судьбу предложенной привычки по голосам. Возвращает новый статус.
create function app_private.evaluate_habit(p_habit_id uuid) returns public.habit_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_habit public.habits;
  v_group public.groups;
  v_others int;
  v_approve int;
  v_reject int;
  v_needed int;
  v_today date;
  v_from date;
begin
  select * into v_habit from public.habits where id = p_habit_id for update;
  if v_habit.status <> 'proposed' then
    return v_habit.status;
  end if;
  select * into v_group from public.groups where id = v_habit.group_id;
  select count(*) - 1 into v_others from public.group_members where group_id = v_habit.group_id;
  select count(*) filter (where vote = 'approve'), count(*) filter (where vote = 'reject')
    into v_approve, v_reject
    from public.habit_votes hv
   where hv.habit_id = p_habit_id
     and exists (select 1 from public.group_members m where m.group_id = hv.group_id and m.user_id = hv.voter_id);

  if v_others <= 0 then
    v_needed := 0; -- группа из одного человека: одобряется автоматически (UI предупреждает)
  elsif v_group.rules ->> 'habitApproval' = 'count' then
    v_needed := least(greatest(coalesce((v_group.rules ->> 'habitApprovalVotes')::int, 2), 1), v_others);
  else
    v_needed := v_others / 2 + 1;
  end if;

  if v_others > 0 and v_reject >= v_needed then
    update public.habits set status = 'rejected', decided_at = app_private.now() where id = p_habit_id;
    return 'rejected';
  end if;
  if v_approve < v_needed then
    return 'proposed';
  end if;

  v_today := (app_private.now() at time zone v_group.timezone)::date;
  v_from := app_private.first_period_start(v_habit.frequency, v_today);

  if v_habit.replaces_habit_id is not null then
    -- Замена вступает в силу только со следующего периода старой привычки.
    select greatest(v_from, b.period_end) into v_from
      from public.habits old, app_private.period_bounds(old.frequency, v_today) b
     where old.id = v_habit.replaces_habit_id;
    update public.habits
       set active_until = least(coalesce(active_until, v_from), v_from)
     where id = v_habit.replaces_habit_id and status = 'active';
  end if;

  update public.habits
     set status = 'active', active_from = v_from, decided_at = app_private.now()
   where id = p_habit_id;
  return 'active';
end;
$$;

create function public.propose_habit(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_frequency public.habit_frequency,
  p_target_count int,
  p_proof_type public.proof_type,
  p_difficulty public.habit_difficulty,
  p_replaces_habit_id uuid default null
) returns public.habits
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_group public.groups;
  v_today date;
  v_count int;
  v_habit public.habits;
  v_old public.habits;
begin
  perform app_private.require_member(p_group_id, v_uid);
  perform app_private.validate_habit(p_title, p_description, p_frequency, p_target_count);
  select * into v_group from public.groups where id = p_group_id;
  v_today := (app_private.now() at time zone v_group.timezone)::date;

  if p_replaces_habit_id is not null then
    select * into v_old from public.habits where id = p_replaces_habit_id;
    if v_old.id is null or v_old.user_id <> v_uid or v_old.group_id <> p_group_id
       or v_old.status <> 'active' or v_old.active_until is not null then
      perform app_private.raise_error('habit_not_found');
    end if;
    if exists (select 1 from public.habits where replaces_habit_id = p_replaces_habit_id and status = 'proposed') then
      perform app_private.raise_error('change_already_proposed');
    end if;
  else
    select count(*) into v_count from public.habits
     where group_id = p_group_id and user_id = v_uid
       and (status = 'proposed' and replaces_habit_id is null
            or status = 'active' and (active_until is null or active_until > v_today));
    if v_count >= coalesce((v_group.rules ->> 'maxActiveHabits')::int, 5) then
      perform app_private.raise_error('habit_limit_reached');
    end if;
  end if;

  insert into public.habits (group_id, user_id, title, description, frequency, target_count,
                             proof_type, difficulty, status, replaces_habit_id)
  values (p_group_id, v_uid, btrim(p_title), btrim(p_description), p_frequency, p_target_count,
          p_proof_type, p_difficulty, 'proposed', p_replaces_habit_id)
  returning * into v_habit;

  perform app_private.evaluate_habit(v_habit.id);
  select * into v_habit from public.habits where id = v_habit.id;
  return v_habit;
end;
$$;

-- Правка предложения (например, по просьбе группы сделать измеримой) сбрасывает голоса.
create function public.edit_proposed_habit(
  p_habit_id uuid,
  p_title text,
  p_description text,
  p_frequency public.habit_frequency,
  p_target_count int,
  p_proof_type public.proof_type,
  p_difficulty public.habit_difficulty
) returns public.habits
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_habit public.habits;
begin
  select * into v_habit from public.habits where id = p_habit_id for update;
  if v_habit.id is null or v_habit.user_id <> v_uid then
    perform app_private.raise_error('habit_not_found');
  end if;
  if v_habit.status <> 'proposed' then
    perform app_private.raise_error('habit_not_editable');
  end if;
  perform app_private.validate_habit(p_title, p_description, p_frequency, p_target_count);
  update public.habits
     set title = btrim(p_title), description = btrim(p_description), frequency = p_frequency,
         target_count = p_target_count, proof_type = p_proof_type, difficulty = p_difficulty
   where id = p_habit_id;
  delete from public.habit_votes where habit_id = p_habit_id;
  perform app_private.evaluate_habit(p_habit_id);
  select * into v_habit from public.habits where id = p_habit_id;
  return v_habit;
end;
$$;

create function public.vote_habit(
  p_habit_id uuid, p_vote public.habit_vote_kind, p_comment text default null
) returns public.habits
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_habit public.habits;
begin
  select * into v_habit from public.habits where id = p_habit_id;
  if v_habit.id is null or not app_private.is_member(v_habit.group_id) then
    perform app_private.raise_error('habit_not_found');
  end if;
  if v_habit.user_id = v_uid then
    perform app_private.raise_error('cannot_vote_own');
  end if;
  if v_habit.status <> 'proposed' then
    perform app_private.raise_error('voting_closed');
  end if;
  if p_vote <> 'approve' and char_length(btrim(coalesce(p_comment, ''))) = 0 then
    perform app_private.raise_error('comment_required');
  end if;

  insert into public.habit_votes (habit_id, voter_id, group_id, vote, comment, created_at)
  values (p_habit_id, v_uid, v_habit.group_id, p_vote, nullif(btrim(coalesce(p_comment, '')), ''), app_private.now())
  on conflict (habit_id, voter_id) do update
    set vote = excluded.vote, comment = excluded.comment, created_at = excluded.created_at;

  perform app_private.evaluate_habit(p_habit_id);
  select * into v_habit from public.habits where id = p_habit_id;
  return v_habit;
end;
$$;

-- Удаление: предложение — сразу; активная привычка — со следующего периода.
-- Текущий период всё равно будет подведён (со штрафом при пропуске).
create function public.archive_habit(p_habit_id uuid) returns public.habits
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_habit public.habits;
  v_today date;
  v_until date;
begin
  select * into v_habit from public.habits where id = p_habit_id for update;
  if v_habit.id is null or v_habit.user_id <> v_uid then
    perform app_private.raise_error('habit_not_found');
  end if;
  if v_habit.status = 'proposed' then
    update public.habits set status = 'archived', decided_at = app_private.now() where id = p_habit_id
    returning * into v_habit;
    return v_habit;
  end if;
  if v_habit.status <> 'active' then
    perform app_private.raise_error('habit_not_editable');
  end if;
  v_today := app_private.group_today(v_habit.group_id);
  if v_habit.active_from > v_today then
    -- Ещё не начавшаяся привычка снимается без последствий.
    v_until := v_habit.active_from;
  else
    select period_end into v_until from app_private.period_bounds(v_habit.frequency, v_today);
  end if;
  update public.habits set active_until = least(coalesce(active_until, v_until), v_until)
   where id = p_habit_id
  returning * into v_habit;
  -- Отложенные замены этой привычки теряют смысл.
  update public.habits set status = 'archived', decided_at = app_private.now()
   where replaces_habit_id = p_habit_id and status = 'proposed';
  return v_habit;
end;
$$;

-- --------------------------------------------------------------- grants
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_member(uuid) to authenticated;
grant execute on function app_private.is_group_admin(uuid) to authenticated;
grant execute on function app_private.shares_group(uuid) to authenticated;

grant execute on function public.nickname_available(text) to authenticated;
grant execute on function public.complete_onboarding(text, text, text) to authenticated;
grant execute on function public.create_checkin(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.vote_checkin(uuid, public.checkin_vote_kind, text) to authenticated;
grant execute on function public.register_proof(uuid, uuid, text, text, timestamptz) to service_role;

grant execute on function public.create_group(text, text, int, int) to authenticated;
grant execute on function public.update_group_settings(uuid, text, text, int, int, text, jsonb, jsonb) to authenticated;
grant execute on function public.create_invite(uuid, int, int) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.invite_preview(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.group_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.propose_habit(uuid, text, text, public.habit_frequency, int, public.proof_type, public.habit_difficulty, uuid) to authenticated;
grant execute on function public.edit_proposed_habit(uuid, text, text, public.habit_frequency, int, public.proof_type, public.habit_difficulty) to authenticated;
grant execute on function public.vote_habit(uuid, public.habit_vote_kind, text) to authenticated;
grant execute on function public.archive_habit(uuid) to authenticated;
