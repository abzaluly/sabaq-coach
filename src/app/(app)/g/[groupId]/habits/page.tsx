import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { HabitSummary } from "@/components/habit-summary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getGroupContext, todayIn } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import type { Habit } from "@/lib/types";
import { HabitActions } from "./habit-actions";

export default async function MyHabitsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { group, me } = await getGroupContext(groupId);
  const t = await getTranslations("habits");
  const supabase = await createClient();
  const { data } = await supabase
    .from("habits")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", me.id)
    .order("created_at", { ascending: false });
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
