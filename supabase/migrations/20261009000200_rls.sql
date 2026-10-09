-- Orle: дефолтный конфиг, вспомогательные функции, RLS и права.

-- ---------------------------------------------------- default config
-- Должно совпадать с config/scoring.ts (проверяет tests/db/config-sync.test.ts).
create function app_private.default_scoring_config() returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'base', jsonb_build_object('daily', 10, 'weekly', 30, 'monthly', 100),
    'difficulty', jsonb_build_object('easy', 0.7, 'medium', 1, 'hard', 1.5),
    'honorMultiplier', 0.5,
    'fullPeriodBonus', 0.2,
    'streakStep', 0.1,
    'streakMaxMultiplier', 2,
    'missPenalty', 0.5,
    'fakePenaltyMultiplier', 3,
    'freezesPerSeason', 2
  );
$$;

create function app_private.default_rules() returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'habitApproval', 'majority',
    'habitApprovalVotes', 2,
    'maxActiveHabits', 5,
    'graceMinutes', 120,
    'reviewWindowHours', 24,
    'confirmationsToApprove', 3,
    'collusionWindowDays', 30,
    'checkinsPerMinute', 5
  );
$$;

alter table public.groups alter column rules set default app_private.default_rules();
alter table public.groups alter column scoring_config set default app_private.default_scoring_config();

-- --------------------------------------------------------- helpers
-- SECURITY DEFINER, чтобы политики не рекурсировали через RLS group_members.
create function app_private.is_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

create function app_private.is_group_admin(p_group_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create function app_private.shares_group(p_user_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = p_user_id
  );
$$;

grant usage on schema app_private to authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_member(uuid) to authenticated;
grant execute on function app_private.is_group_admin(uuid) to authenticated;
grant execute on function app_private.shares_group(uuid) to authenticated;

-- ---------------------------------------------------------- grants
-- По умолчанию клиент только читает. Запись — через RPC (SECURITY DEFINER).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
-- Единственные таблицы, куда клиент пишет напрямую — его собственные настройки.
grant insert, update, delete on public.notification_prefs to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;
-- Каталоги видны всем, в том числе на экране входа.
grant select on public.cosmetics, public.achievements to anon;

-- ------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.invites enable row level security;
alter table public.seasons enable row level security;
alter table public.habits enable row level security;
alter table public.habit_votes enable row level security;
alter table public.periods enable row level security;
alter table public.checkins enable row level security;
alter table public.proofs enable row level security;
alter table public.checkin_votes enable row level security;
alter table public.checkin_reactions enable row level security;
alter table public.checkin_comments enable row level security;
alter table public.freezes enable row level security;
alter table public.points_ledger enable row level security;
alter table public.cosmetics enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;
alter table public.equipped_cosmetics enable row level security;
alter table public.audit_log enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

-- Профили: свой + участников общих групп.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app_private.shares_group(id));

create policy groups_select on public.groups for select to authenticated
  using (app_private.is_member(id));

create policy group_members_select on public.group_members for select to authenticated
  using (app_private.is_member(group_id));

-- Инвайты видят только owner/admin.
create policy invites_select on public.invites for select to authenticated
  using (app_private.is_group_admin(group_id));

create policy seasons_select on public.seasons for select to authenticated
  using (app_private.is_member(group_id));

create policy habits_select on public.habits for select to authenticated
  using (app_private.is_member(group_id));

create policy habit_votes_select on public.habit_votes for select to authenticated
  using (app_private.is_member(group_id));

create policy periods_select on public.periods for select to authenticated
  using (app_private.is_member(group_id));

create policy checkins_select on public.checkins for select to authenticated
  using (app_private.is_member(group_id));

create policy proofs_select on public.proofs for select to authenticated
  using (app_private.is_member(group_id));

create policy checkin_votes_select on public.checkin_votes for select to authenticated
  using (app_private.is_member(group_id));

create policy checkin_reactions_select on public.checkin_reactions for select to authenticated
  using (app_private.is_member(group_id));

create policy checkin_comments_select on public.checkin_comments for select to authenticated
  using (app_private.is_member(group_id));

create policy freezes_select on public.freezes for select to authenticated
  using (app_private.is_member(group_id));

-- Прозрачность: любой участник видит весь журнал своей группы.
create policy points_ledger_select on public.points_ledger for select to authenticated
  using (app_private.is_member(group_id));

create policy cosmetics_select on public.cosmetics for select to anon, authenticated using (true);
create policy achievements_select on public.achievements for select to anon, authenticated using (true);

create policy user_achievements_select on public.user_achievements for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_member(group_id));

create policy equipped_cosmetics_select on public.equipped_cosmetics for select to authenticated
  using (user_id = (select auth.uid()) or app_private.shares_group(user_id));

create policy audit_log_select on public.audit_log for select to authenticated
  using (group_id is not null and app_private.is_group_admin(group_id));

create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
