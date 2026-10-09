import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type GroupSummary = { group_id: string; total_points: number; best_streak: number };

/** Мои очки и лучший стрик в каждой группе (один запрос на рендер). */
export const getMySummary = cache(async (): Promise<GroupSummary[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_summary");
  return ((data ?? []) as GroupSummary[]).map((r) => ({ ...r, total_points: Number(r.total_points) }));
});
