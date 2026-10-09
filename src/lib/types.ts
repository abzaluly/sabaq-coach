/**
 * Типы строк БД, которые читает интерфейс. Источник правды — миграции;
 * при наличии локального Supabase можно сгенерировать полные типы `pnpm db:types`.
 */

import type { DEFAULT_RULES, DEFAULT_SCORING } from "@config/scoring";

export type GroupRole = "owner" | "admin" | "member";
export type HabitFrequency = "daily" | "weekly" | "monthly";
export type ProofType = "photo" | "photo_text" | "honor";
export type HabitDifficulty = "easy" | "medium" | "hard";
export type HabitStatus = "proposed" | "active" | "rejected" | "archived";
export type HabitVoteKind = "approve" | "reject" | "request_changes";
export type CheckinStatus = "pending" | "approved" | "rejected";
export type CheckinVoteKind = "confirm" | "dispute";

type Widen<T> = { -readonly [K in keyof T]: T[K] extends object ? Widen<T[K]> : T[K] extends number ? number : T[K] };

export type Rules = Widen<typeof DEFAULT_RULES>;
export type Scoring = Widen<typeof DEFAULT_SCORING>;

export type ProfileLite = {
  id: string;
  display_name: string;
  nickname: string;
  character_seed: string;
};

export type Group = {
  id: string;
  name: string;
  avatar_url: string | null;
  timezone: string;
  season_days: number;
  max_members: number;
  rules: Rules;
  scoring_config: Scoring;
  pending_changes: { timezone?: string; rules?: Rules; scoring_config?: Scoring } | null;
  pending_effective_from: string | null;
  created_at: string;
};

export type Member = {
  user_id: string;
  role: GroupRole;
  joined_at: string;
  profile: ProfileLite;
};

export type Habit = {
  id: string;
  group_id: string;
  user_id: string;
  title: string;
  description: string;
  frequency: HabitFrequency;
  target_count: number;
  proof_type: ProofType;
  difficulty: HabitDifficulty;
  status: HabitStatus;
  active_from: string | null;
  active_until: string | null;
  replaces_habit_id: string | null;
  created_at: string;
};

export type HabitVote = {
  habit_id: string;
  voter_id: string;
  vote: HabitVoteKind;
  comment: string | null;
  created_at: string;
};

export type Invite = {
  id: string;
  code: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
  created_at: string;
};

export type Season = {
  id: string;
  number: number;
  starts_on: string;
  ends_on: string;
  status: "active" | "closed";
};
