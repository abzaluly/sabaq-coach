import "server-only";
import { levelForPoints, moodFor, stageForPoints, type Cosmetics, type Mood, type Stage } from "@/lib/character";
import { createClient } from "@/lib/supabase/server";

export type ArenaRow = {
  user_id: string;
  total_points: number;
  season_points: number;
  best_streak: number;
  today_total: number;
  today_done: number;
  frozen_today: boolean;
  missed_recently: boolean;
  level: number;
  stage: Stage;
  mood: Mood;
  cosmetics: Cosmetics;
  allDoneToday: boolean;
};

export async function getEquipped(userIds: string[]): Promise<Map<string, Cosmetics>> {
  const map = new Map<string, Cosmetics>();
  if (userIds.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase.from("equipped_cosmetics").select("user_id, kind, cosmetic_code").in("user_id", userIds);
  for (const row of data ?? []) {
    const c = map.get(row.user_id) ?? {};
    c[row.kind as keyof Cosmetics] = row.cosmetic_code;
    map.set(row.user_id, c);
  }
  return map;
}

/** Состояние участников для арены: очки, уровень, стадия и настроение персонажа. */
export async function getArena(groupId: string): Promise<Map<string, ArenaRow>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("group_arena", { p_group_id: groupId });
  const rows = (data ?? []) as Omit<ArenaRow, "level" | "stage" | "mood" | "cosmetics" | "allDoneToday">[];
  const equipped = await getEquipped(rows.map((r) => r.user_id));
  return new Map(
    rows.map((r) => {
      const total = Number(r.total_points);
      return [
        r.user_id,
        {
          ...r,
          total_points: total,
          season_points: Number(r.season_points),
          level: levelForPoints(total),
          stage: stageForPoints(total),
          mood: moodFor({ streak: r.best_streak, missedRecently: r.missed_recently, frozen: r.frozen_today }),
          cosmetics: equipped.get(r.user_id) ?? {},
          allDoneToday: r.today_total > 0 && r.today_done >= r.today_total,
        },
      ];
    }),
  );
}
