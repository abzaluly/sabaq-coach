-- Orle: серверные функции, через которые идёт вся запись.
-- Ошибки бросаются с errcode P0001 и машинным кодом в message
-- (например 'not_your_habit'); клиент переводит код через i18n.

-- ------------------------------------------------------- time helpers
create function app_private.period_bounds(
  p_frequency public.habit_frequency, p_day date,
  out period_start date, out period_end date
)
language sql immutable set search_path = ''
as $$
  select
    case p_frequency
      when 'daily' then p_day
      when 'weekly' then date_trunc('week', p_day)::date        -- ISO: понедельник
      when 'monthly' then date_trunc('month', p_day)::date
    end,
    case p_frequency
      when 'daily' then p_day + 1
      when 'weekly' then date_trunc('week', p_day)::date + 7
      when 'monthly' then (date_trunc('month', p_day) + interval '1 month')::date
    end;
$$;

create function app_private.raise_error(p_code text, p_detail text default null) returns void
language plpgsql set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

create function app_private.require_uid() returns uuid
language plpgsql stable set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform app_private.raise_error('not_authenticated');
  end if;
  return v_uid;
end;
$$;

create function app_private.audit(
  p_group_id uuid, p_user_id uuid, p_kind text, p_severity smallint, p_details jsonb
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_log (group_id, user_id, kind, severity, details)
  values (p_group_id, p_user_id, p_kind, p_severity, coalesce(p_details, '{}'));
$$;

-- ------------------------------------------------------- onboarding
create function public.nickname_available(p_nickname text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_nickname ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (
       select 1 from public.profiles
       where nickname operator(extensions.=) p_nickname::extensions.citext
         and id is distinct from auth.uid()
     );
$$;

create function public.complete_onboarding(
  p_display_name text, p_nickname text, p_character_seed text
) returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_profile public.profiles;
begin
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then
    perform app_private.raise_error('invalid_display_name');
  end if;
  if coalesce(p_nickname, '') !~ '^[A-Za-z0-9_]{3,20}$' then
    perform app_private.raise_error('invalid_nickname');
  end if;
  if char_length(coalesce(p_character_seed, '')) not between 1 and 64 then
    perform app_private.raise_error('invalid_character');
  end if;

  begin
    update public.profiles
       set display_name = btrim(p_display_name),
           nickname = p_nickname,
           character_seed = p_character_seed,
           onboarded_at = coalesce(onboarded_at, now())
     where id = v_uid
    returning * into v_profile;
  exception when unique_violation then
    perform app_private.raise_error('nickname_taken');
  end;

  if v_profile.id is null then
    perform app_private.raise_error('profile_not_found');
  end if;
  return v_profile;
end;
$$;

-- --------------------------------------------------------- proofs
-- Регистрирует обработанное сервером фото (EXIF удалён, pHash посчитан).
-- Вызывается только Route Handler'ом с service_role — клиент не может
-- подсунуть свой хэш или время съёмки.
create function public.register_proof(
  p_user_id uuid, p_group_id uuid, p_storage_path text,
  p_phash text, p_exif_taken_at timestamptz
) returns public.proofs
language plpgsql security definer set search_path = ''
as $$
declare
  v_proof public.proofs;
  v_flags text[] := '{}';
  v_now timestamptz := app_private.now();
begin
  if not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id
  ) then
    perform app_private.raise_error('not_a_member');
  end if;

  if p_phash is not null and exists (
    select 1 from public.proofs
    where group_id = p_group_id and phash = p_phash
  ) then
    v_flags := array_append(v_flags, 'duplicate_image');
  end if;
  if p_exif_taken_at is not null and p_exif_taken_at < v_now - interval '24 hours' then
    v_flags := array_append(v_flags, 'old_photo');
  end if;

  insert into public.proofs (user_id, group_id, storage_path, phash, exif_taken_at, uploaded_at, flags)
  values (p_user_id, p_group_id, p_storage_path, p_phash, p_exif_taken_at, v_now, v_flags)
  returning * into v_proof;

  if cardinality(v_flags) > 0 then
    perform app_private.audit(p_group_id, p_user_id, 'suspicious_proof', 2::smallint,
      jsonb_build_object('proof_id', v_proof.id, 'flags', v_flags));
  end if;
  return v_proof;
end;
$$;

-- -------------------------------------------------------- checkins
-- Время отметки, период и слот определяет только сервер. Клиент может
-- лишь попросить засчитать вчерашний день, и только в grace-окно после полуночи.
create function public.create_checkin(
  p_habit_id uuid,
  p_note text default null,
  p_proof_id uuid default null,
  p_previous_day boolean default false
) returns public.checkins
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_habit public.habits;
  v_group public.groups;
  v_now timestamptz := app_private.now();
  v_local timestamp;
  v_day date;
  v_bounds record;
  v_active_count int;
  v_slot smallint;
  v_proof public.proofs;
  v_checkin public.checkins;
  v_recent int;
begin
  select * into v_habit from public.habits where id = p_habit_id;
  if v_habit.id is null then
    perform app_private.raise_error('habit_not_found');
  end if;
  if v_habit.user_id <> v_uid then
    perform app_private.raise_error('not_your_habit');
  end if;
  if not exists (
    select 1 from public.group_members where group_id = v_habit.group_id and user_id = v_uid
  ) then
    perform app_private.raise_error('not_a_member');
  end if;

  select * into v_group from public.groups where id = v_habit.group_id;

  -- Rate limit: защита от скриптов и «пачек» отметок. Исключение откатило бы
  -- запись в аудит, поэтому здесь возвращаем NULL — клиент трактует это
  -- как 'rate_limited' (см. src/lib/rpc.ts).
  select count(*) into v_recent from public.checkins
   where user_id = v_uid and created_at > v_now - interval '1 minute';
  if v_recent >= coalesce((v_group.rules ->> 'checkinsPerMinute')::int, 5) then
    perform app_private.audit(v_group.id, v_uid, 'rate_limited_checkin', 2::smallint,
      jsonb_build_object('recent', v_recent, 'habit_id', v_habit.id));
    return null;
  end if;

  v_local := v_now at time zone v_group.timezone;
  v_day := v_local::date;
  if p_previous_day then
    if v_local - v_day::timestamp
       >= make_interval(mins => coalesce((v_group.rules ->> 'graceMinutes')::int, 120)) then
      perform app_private.raise_error('grace_expired');
    end if;
    v_day := v_day - 1;
  end if;

  select * into v_bounds from app_private.period_bounds(v_habit.frequency, v_day);

  if v_habit.status <> 'active'
     or v_habit.active_from is null
     or v_bounds.period_start < v_habit.active_from
     or (v_habit.active_until is not null and v_bounds.period_start >= v_habit.active_until) then
    perform app_private.raise_error('habit_not_active');
  end if;

  if exists (
    select 1 from public.periods
    where habit_id = v_habit.id and period_start = v_bounds.period_start and status = 'settled'
  ) then
    perform app_private.raise_error('period_closed');
  end if;

  if exists (
    select 1 from public.freezes
    where group_id = v_habit.group_id and user_id = v_uid and v_day between starts_on and ends_on
  ) then
    perform app_private.raise_error('day_frozen');
  end if;

  -- Пруф обязателен для фото-привычек и должен быть загружен только что.
  if v_habit.proof_type in ('photo', 'photo_text') then
    if p_proof_id is null then
      perform app_private.raise_error('proof_required');
    end if;
    select * into v_proof from public.proofs where id = p_proof_id for update;
    if v_proof.id is null or v_proof.user_id <> v_uid or v_proof.group_id <> v_habit.group_id then
      perform app_private.raise_error('proof_not_found');
    end if;
    if v_proof.checkin_id is not null then
      perform app_private.raise_error('proof_already_used');
    end if;
    if v_proof.uploaded_at < v_now - interval '15 minutes' then
      perform app_private.raise_error('proof_expired');
    end if;
  end if;
  if v_habit.proof_type = 'photo_text' and char_length(btrim(coalesce(p_note, ''))) = 0 then
    perform app_private.raise_error('note_required');
  end if;

  select count(*) into v_active_count from public.checkins
   where habit_id = v_habit.id and period_start = v_bounds.period_start and status <> 'rejected';
  if v_active_count >= v_habit.target_count then
    perform app_private.raise_error('period_complete');
  end if;

  select coalesce(max(slot), 0) + 1 into v_slot from public.checkins
   where habit_id = v_habit.id and period_start = v_bounds.period_start;

  insert into public.periods (habit_id, group_id, user_id, period_start, period_end, required_count)
  values (v_habit.id, v_habit.group_id, v_uid, v_bounds.period_start, v_bounds.period_end, v_habit.target_count)
  on conflict (habit_id, period_start) do nothing;

  begin
    insert into public.checkins (
      habit_id, group_id, user_id, period_start, local_date, slot, note, status, created_at, review_until
    ) values (
      v_habit.id, v_habit.group_id, v_uid, v_bounds.period_start, v_day, v_slot,
      nullif(btrim(coalesce(p_note, '')), ''), 'pending', v_now,
      v_now + make_interval(hours => coalesce((v_group.rules ->> 'reviewWindowHours')::int, 24))
    ) returning * into v_checkin;
  exception when unique_violation then
    perform app_private.raise_error('already_checked_in');
  end;

  if v_proof.id is not null then
    update public.proofs set checkin_id = v_checkin.id where id = v_proof.id;
  end if;

  return v_checkin;
end;
$$;

-- Голос за отметку. Вес подтверждения убывает, если этот судья часто
-- подтверждает одного и того же автора (защита от сговора «я тебе — ты мне»).
create function public.vote_checkin(
  p_checkin_id uuid, p_vote public.checkin_vote_kind, p_comment text default null
) returns public.checkin_votes
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_checkin public.checkins;
  v_group public.groups;
  v_now timestamptz := app_private.now();
  v_prior int;
  v_weight numeric(5, 3) := 1;
  v_vote public.checkin_votes;
begin
  select * into v_checkin from public.checkins where id = p_checkin_id;
  if v_checkin.id is null or not exists (
    select 1 from public.group_members where group_id = v_checkin.group_id and user_id = v_uid
  ) then
    perform app_private.raise_error('checkin_not_found');
  end if;
  if v_checkin.user_id = v_uid then
    perform app_private.raise_error('cannot_vote_own');
  end if;
  if v_checkin.status <> 'pending' or v_now >= v_checkin.review_until then
    perform app_private.raise_error('review_closed');
  end if;
  if p_vote = 'dispute' and char_length(btrim(coalesce(p_comment, ''))) = 0 then
    perform app_private.raise_error('comment_required');
  end if;

  select * into v_group from public.groups where id = v_checkin.group_id;

  if p_vote = 'confirm' then
    select count(*) into v_prior
      from public.checkin_votes cv
      join public.checkins c on c.id = cv.checkin_id
     where cv.voter_id = v_uid
       and c.user_id = v_checkin.user_id
       and cv.vote = 'confirm'
       and cv.checkin_id <> p_checkin_id
       and cv.created_at > v_now - make_interval(days => coalesce((v_group.rules ->> 'collusionWindowDays')::int, 30));
    v_weight := round(1.0 / (1 + v_prior), 3);
    if v_weight < 0.05 then
      v_weight := 0.05;
    end if;
  end if;

  insert into public.checkin_votes (checkin_id, voter_id, group_id, vote, weight, comment, created_at)
  values (p_checkin_id, v_uid, v_checkin.group_id, p_vote, v_weight, nullif(btrim(coalesce(p_comment, '')), ''), v_now)
  on conflict (checkin_id, voter_id) do update
    set vote = excluded.vote, weight = excluded.weight, comment = excluded.comment, created_at = excluded.created_at
  returning * into v_vote;

  return v_vote;
end;
$$;

-- -------------------------------------------------------- grants
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_member(uuid) to authenticated;
grant execute on function app_private.is_group_admin(uuid) to authenticated;
grant execute on function app_private.shares_group(uuid) to authenticated;
grant execute on function public.nickname_available(text) to authenticated;
grant execute on function public.complete_onboarding(text, text, text) to authenticated;
grant execute on function public.create_checkin(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.vote_checkin(uuid, public.checkin_vote_kind, text) to authenticated;
revoke execute on function public.register_proof(uuid, uuid, text, text, timestamptz) from authenticated;
grant execute on function public.register_proof(uuid, uuid, text, text, timestamptz) to service_role;
