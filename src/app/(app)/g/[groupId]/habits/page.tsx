import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { HabitSummary } from "@/components/habit-summary";
import { TodayList, type TodayItem } from "@/components/today-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { addDays, getGroupContext, todayIn } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import type { Habit } from "@/lib/types";
import { FreezePanel, type FreezeRow } from "./freeze-panel";
import { HabitActions } from "./habit-actions";

export default async function MyHabitsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { group, me, season } = await getGroupContext(groupId);
  const t = await getTranslations("habits");
  const supabase = await createClient();
  const [{ data }, { data: todayRows }, { data: freezeRows }] = await Promise.all([
    supabase.from("habits").select("*").eq("group_id", groupId).eq("user_id", me.id).order("created_at", { ascending: false }),
    supabase.rpc("my_today", { p_group_id: groupId }),
    season
      ? supabase.from("freezes").select("id, starts_on, ends_on, reason").eq("group_id", groupId).eq("user_id", me.id).eq("season_id", season.id).order("starts_on")
      : Promise.resolve({ data: [] }),
  ]);
  const freezes = (freezeRows ?? []) as FreezeRow[];
  const todayItems = (todayRows ?? []) as TodayItem[];
  const habits = (data ?? []) as Habit[];
  const today = todayIn(group.timezone);

  const isCurrent = (h: Habit) =>
    (h.status === "active" && (!h.active_until || h.active_until > today)) || h.status === "proposed";
  const current = habits.filter(isCurrent);
  const past = habits.filter((h) => !isCurrent(h));
  const activeCount = current.filter((h) => !h.replaces_habit_id).length;
  const pendingChanges = new Set(habits.filter((h) => h.status === "proposed" && h.replaces_habit_id).map((h) => h.replaces_habit_id));

  return (
    <section className="space-y-4">
      {todayItems.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-bold">{t("todayTitle")}</h2>
          <TodayList items={todayItems} showGroup={false} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          {t("mine")}{" "}
          <span className="text-sm font-semibold text-muted">
            {activeCount}/{group.rules.maxActiveHabits}
          </span>
        </h2>
        {activeCount < group.rules.maxActiveHabits && (
          <Button asChild>
            <Link href={`/g/${groupId}/habits/new`}>
              <Plus />
              {t("add")}
            </Link>
          </Button>
        )}
      </div>

      {current.length === 0 ? (
        <Card className="text-muted">{t("empty")}</Card>
      ) : (
        <ul className="space-y-3">
          {current.map((h) => (
            <li key={h.id}>
              <Card>
                <HabitSummary habit={h} today={today} />
                {h.replaces_habit_id && <p className="mt-2 text-xs font-semibold text-muted">{t("isChange")}</p>}
                <HabitActions groupId={groupId} habit={h} today={today} changePending={pendingChanges.has(h.id)} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <FreezePanel
        groupId={groupId}
        freezes={freezes}
        used={freezes.length}
        limit={group.scoring_config.freezesPerSeason}
        tomorrow={addDays(today, 1)}
      />

      {past.length > 0 && (
        <details className="rounded-2xl">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-muted">{t("history", { count: past.length })}</summary>
          <ul className="mt-2 space-y-2">
            {past.map((h) => (
              <li key={h.id}>
                <Card className="opacity-80">
                  <HabitSummary habit={h} today={today} />
                </Card>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
