/**
 * Единственный источник коэффициентов очков и правил проверки.
 *
 * Эти значения копируются в `groups.scoring_config` / `groups.rules` при
 * создании группы (см. миграцию `app_private.default_scoring_config()`).
 * Тест `tests/db/config-sync.test.ts` падает, если SQL-дефолты разошлись
 * с этим файлом. Меняете коэффициент — меняйте здесь и в миграции.
 */

export const DEFAULT_SCORING = {
  /** Базовые очки за период по частоте. */
  base: { daily: 10, weekly: 30, monthly: 100 },
  /** Множитель сложности. */
  difficulty: { easy: 0.7, medium: 1, hard: 1.5 },
  /** Множитель для привычек без пруфа (только отметка). */
  honorMultiplier: 0.5,
  /** Бонус за полное выполнение периода «N раз» (доля от базы). */
  fullPeriodBonus: 0.2,
  /** Множитель стрика = 1 + streakStep × стрик, не больше streakMaxMultiplier. */
  streakStep: 0.1,
  streakMaxMultiplier: 2,
  /** Пропуск периода (0 отметок): штраф = доля базовых очков. */
  missPenalty: 0.5,
  /** Фейк: очки отзываются + штраф = fakePenaltyMultiplier × база одной отметки. */
  fakePenaltyMultiplier: 3,
  /** Заморозок на участника в группе за сезон. */
  freezesPerSeason: 2,
} as const;

export const DEFAULT_RULES = {
  /** Как одобряются новые привычки: "majority" — большинство остальных участников, "count" — N голосов. */
  habitApproval: "majority" as "majority" | "count",
  habitApprovalVotes: 2,
  /** Лимит активных привычек на участника в группе. */
  maxActiveHabits: 5,
  /** Минуты после полуночи, в течение которых можно отметить вчерашний период. */
  graceMinutes: 120,
  /** Окно проверки отметки группой, часы. */
  reviewWindowHours: 24,
  /** Досрочное одобрение отметки при сумме весов подтверждений ≥ N. */
  confirmationsToApprove: 3,
  /** Окно (дни), в котором подтверждения одного судьи одному автору теряют вес. */
  collusionWindowDays: 30,
  /** Максимум отметок пользователя за минуту, дальше — отказ и запись в аудит. */
  checkinsPerMinute: 5,
} as const;

export type ScoringConfig = typeof DEFAULT_SCORING;
export type GroupRules = typeof DEFAULT_RULES;
export type Frequency = keyof ScoringConfig["base"];
export type Difficulty = keyof ScoringConfig["difficulty"];
