-- Orle, этап 3: проверка отметок группой, пруфы, лента, комментарии, реакции, модерация.

-- Хук начисления очков. Здесь — заглушка; движок очков (0600_points.sql) её заменяет.
create function app_private.on_checkin_decided(p_checkin_id uuid, p_previous public.checkin_status) returns void
language plpgsql security definer set search_path = ''
as $$ begin null; end; $$;

-- Итог голосования по отметке.
--   * досрочно approved: сумма весов подтверждений ≥ confirmationsToApprove и нет споров;
--   * досрочно rejected: «против» больше половины всех, кто мог голосовать;
--   * по окончании окна: rejected, если вес «против» больше веса «за», иначе approved.
create function app_private.decide_checkin(p_checkin_id uuid) returns public.checkin_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.checkins;
  v_rules jsonb;
  v_confirm numeric;
  v_dispute numeric;
  v_disputes int;
  v_voters int;
  v_status public.checkin_status;
  v_reason text;
  v_now timestamptz := app_private.now();
begin
  select * into v_c from public.checkins where id = p_checkin_id for update;
  if v_c.id is null or v_c.status <> 'pending' then
    return v_c.status;
  end if;
  select rules into v_rules from public.groups where id = v_c.group_id;
  select coalesce(sum(weight) filter (where vote = 'confirm'), 0),
         coalesce(sum(weight) filter (where vote = 'dispute'), 0),
         count(*) filter (where vote = 'dispute')
    into v_confirm, v_dispute, v_disputes
    from public.checkin_votes where checkin_id = p_checkin_id;
  select count(*) - 1 into v_voters from public.group_members where group_id = v_c.group_id;

  if v_voters > 0 and v_disputes * 2 > v_voters then
    v_status := 'rejected';
    v_reason := 'majority_disputed';
  elsif v_disputes = 0 and v_confirm >= coalesce((v_rules ->> 'confirmationsToApprove')::numeric, 3) then
    v_status := 'approved';
    v_reason := 'confirmed';
  elsif v_now >= v_c.review_until then
    if v_dispute > v_confirm then
      v_status := 'rejected';
      v_reason := 'disputed';
    else
      v_status := 'approved';
      v_reason := case when v_confirm > 0 then 'confirmed' else 'review_window_passed' end;
    end if;
  else
    return 'pending';
  end if;

  update public.checkins
     set status = v_status, decided_at = v_now, decision_reason = v_reason
   where id = p_checkin_id;
  perform app_private.on_checkin_decided(p_checkin_id, 'pending');
  return v_status;
end;
$$;

create function app_private.decide_due_checkins() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.checkins
     where status = 'pending' and review_until <= app_private.now()
     order by review_until
     for update skip locked
  loop
    perform app_private.decide_checkin(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- vote_checkin из 0300 теперь сразу пересчитывает решение.
create or replace function public.vote_checkin(
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
    v_weight := greatest(round(1.0 / (1 + v_prior), 3), 0.05);
  end if;

  insert into public.checkin_votes (checkin_id, voter_id, group_id, vote, weight, comment, created_at)
  values (p_checkin_id, v_uid, v_checkin.group_id, p_vote, v_weight, nullif(btrim(coalesce(p_comment, '')), ''), v_now)
  on conflict (checkin_id, voter_id) do update
    set vote = excluded.vote, weight = excluded.weight, comment = excluded.comment, created_at = excluded.created_at
  returning * into v_vote;

  if p_vote = 'dispute' then
    perform app_private.audit(v_checkin.group_id, v_checkin.user_id, 'checkin_disputed', 1::smallint,
      jsonb_build_object('checkin_id', p_checkin_id, 'by', v_uid));
  end if;

  perform app_private.decide_checkin(p_checkin_id);
  return v_vote;
end;
$$;

-- Модерация owner/admin: отклонить (в т.ч. уже зачтённую) отметку как фейк.
-- Свою отметку модерировать нельзя.
create function public.moderate_checkin(p_checkin_id uuid, p_reason text) returns public.checkins
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_c public.checkins;
  v_prev public.checkin_status;
begin
  select * into v_c from public.checkins where id = p_checkin_id for update;
  if v_c.id is null then
    perform app_private.raise_error('checkin_not_found');
  end if;
  perform app_private.require_admin(v_c.group_id, v_uid);
  if v_c.user_id = v_uid then
    perform app_private.raise_error('cannot_vote_own');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    perform app_private.raise_error('comment_required');
  end if;
  if v_c.status = 'rejected' then
    return v_c;
  end if;
  v_prev := v_c.status;
  update public.checkins
     set status = 'rejected', decided_at = app_private.now(), decision_reason = 'moderator: ' || btrim(p_reason)
   where id = p_checkin_id
  returning * into v_c;
  perform app_private.audit(v_c.group_id, v_uid, 'checkin_moderated', 2::smallint,
    jsonb_build_object('checkin_id', p_checkin_id, 'author', v_c.user_id, 'reason', p_reason, 'previous', v_prev));
  perform app_private.on_checkin_decided(p_checkin_id, v_prev);
  return v_c;
end;
$$;

create function public.resolve_audit(p_audit_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_group uuid;
begin
  select group_id into v_group from public.audit_log where id = p_audit_id;
  if v_group is null then
    perform app_private.raise_error('not_a_member');
  end if;
  perform app_private.require_admin(v_group, v_uid);
  update public.audit_log set resolved_at = app_private.now(), resolved_by = v_uid where id = p_audit_id and resolved_at is null;
end;
$$;

-- ------------------------------------------------------ comments & reactions
create function public.add_comment(p_checkin_id uuid, p_body text) returns public.checkin_comments
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_group uuid;
  v_recent int;
  v_row public.checkin_comments;
begin
  select group_id into v_group from public.checkins where id = p_checkin_id;
  if v_group is null or not app_private.is_member(v_group) then
    perform app_private.raise_error('checkin_not_found');
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 500 then
    perform app_private.raise_error('invalid_comment');
  end if;
  select count(*) into v_recent from public.checkin_comments
   where user_id = v_uid and created_at > app_private.now() - interval '1 minute';
  if v_recent >= 10 then
    perform app_private.raise_error('rate_limited');
  end if;
  insert into public.checkin_comments (checkin_id, user_id, group_id, body, created_at)
  values (p_checkin_id, v_uid, v_group, btrim(p_body), app_private.now())
  returning * into v_row;
  return v_row;
end;
$$;

create function public.toggle_reaction(p_checkin_id uuid, p_emoji text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_group uuid;
begin
  select group_id into v_group from public.checkins where id = p_checkin_id;
  if v_group is null or not app_private.is_member(v_group) then
    perform app_private.raise_error('checkin_not_found');
  end if;
  delete from public.checkin_reactions where checkin_id = p_checkin_id and user_id = v_uid and emoji = p_emoji;
  if found then
    return false;
  end if;
  begin
    insert into public.checkin_reactions (checkin_id, user_id, group_id, emoji) values (p_checkin_id, v_uid, v_group, p_emoji);
  exception when check_violation then
    perform app_private.raise_error('invalid_reaction');
  end;
  return true;
end;
$$;

-- -------------------------------------------------- proofs: near-duplicates
-- Похожие изображения (расстояние Хэмминга dHash ≤ 6 из 64 бит) тоже помечаются.
create or replace function public.register_proof(
  p_user_id uuid, p_group_id uuid, p_storage_path text,
  p_phash text, p_exif_taken_at timestamptz
) returns public.proofs
language plpgsql security definer set search_path = ''
as $$
declare
  v_proof public.proofs;
  v_flags text[] := '{}';
  v_now timestamptz := app_private.now();
  v_recent int;
  v_dup uuid;
begin
  if not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id
  ) then
    perform app_private.raise_error('not_a_member');
  end if;
  select count(*) into v_recent from public.proofs where user_id = p_user_id and uploaded_at > v_now - interval '1 minute';
  if v_recent >= 10 then
    perform app_private.raise_error('rate_limited');
  end if;

  if p_phash is not null then
    select id into v_dup from public.proofs
     where group_id = p_group_id and phash is not null
       and bit_count(('x' || phash)::bit(64) # ('x' || p_phash)::bit(64)) <= 6
     limit 1;
    if v_dup is not null then
      v_flags := array_append(v_flags, 'duplicate_image');
    end if;
  end if;
  if p_exif_taken_at is not null and p_exif_taken_at < v_now - interval '24 hours' then
    v_flags := array_append(v_flags, 'old_photo');
  end if;

  insert into public.proofs (user_id, group_id, storage_path, phash, exif_taken_at, uploaded_at, flags)
  values (p_user_id, p_group_id, p_storage_path, p_phash, p_exif_taken_at, v_now, v_flags)
  returning * into v_proof;

  if cardinality(v_flags) > 0 then
    perform app_private.audit(p_group_id, p_user_id, 'suspicious_proof', 2::smallint,
      jsonb_build_object('proof_id', v_proof.id, 'flags', v_flags, 'similar_to', v_dup));
  end if;
  return v_proof;
end;
$$;

-- Неиспользованный пруф (загрузка без отметки) удаляет сервер.
create function public.discard_proof(p_proof_id uuid) returns text
language sql security definer set search_path = ''
as $$
  delete from public.proofs where id = p_proof_id and checkin_id is null returning storage_path;
$$;

-- Пруфы, так и не привязанные к отметке за сутки, — к удалению из хранилища.
create function public.stale_proofs() returns setof public.proofs
language sql security definer set search_path = ''
as $$
  delete from public.proofs
   where checkin_id is null and uploaded_at < app_private.now() - interval '1 day'
  returning *;
$$;

-- ---------------------------------------------------------- storage / realtime
-- Бакет пруфов приватный: клиенты получают только подписанные ссылки от сервера.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('proofs', 'proofs', false, 10485760, array['image/webp', 'image/jpeg'])
    on conflict (id) do nothing;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.checkins, public.checkin_votes, public.checkin_comments, public.checkin_reactions;
  end if;
end
$$;

-- ------------------------------------------------------------------- grants
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_member(uuid) to authenticated;
grant execute on function app_private.is_group_admin(uuid) to authenticated;
grant execute on function app_private.shares_group(uuid) to authenticated;

grant execute on function public.nickname_available(text) to authenticated;
grant execute on function public.complete_onboarding(text, text, text) to authenticated;
grant execute on function public.create_checkin(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.vote_checkin(uuid, public.checkin_vote_kind, text) to authenticated;
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
grant execute on function public.moderate_checkin(uuid, text) to authenticated;
grant execute on function public.resolve_audit(bigint) to authenticated;
grant execute on function public.add_comment(uuid, text) to authenticated;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;

grant execute on function public.register_proof(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.discard_proof(uuid) to service_role;
grant execute on function public.stale_proofs() to service_role;
