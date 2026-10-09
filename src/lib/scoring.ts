import type { HabitDifficulty, HabitFrequency, ProofType, Scoring } from "@/lib/types";

/**
 * Предпросмотр очков для интерфейса. Начисляет очки ТОЛЬКО сервер
 * (app_private.habit_base_points в миграции движка) — эта функция повторяет ту же формулу,
 * а тест tests/db/scoring.test.ts сверяет их.
 */
export function basePoints(
  scoring: Scoring,
  habit: { frequency: HabitFrequency; difficulty: HabitDifficulty; proof_type: ProofType },
): number {
  const honor = habit.proof_type === "honor" ? scoring.honorMultiplier : 1;
  return round2(scoring.base[habit.frequency] * scoring.difficulty[habit.difficulty] * honor);
}

export function perCheckinPoints(
  scoring: Scoring,
  habit: { frequency: HabitFrequency; difficulty: HabitDifficulty; proof_type: ProofType; target_count: number },
): number {
  return round2(basePoints(scoring, habit) / habit.target_count);
}

export function streakMultiplier(scoring: Scoring, streak: number): number {
  return Math.min(1 + scoring.streakStep * Math.max(0, streak), scoring.streakMaxMultiplier);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
