import { ChevronRight, Flame, Plus, Ticket } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TodayList, type TodayItem } from "@/components/today-list";
import { Card } from "@/components/ui/card";
import { requireOnboardedProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getMySummary } from "@/lib/summary";

export default async function HomePage() {
  const profile = await requireOnboardedProfile();
  const t = await getTranslations("home");
  const supabase = await createClient();
  const [{ data: groups }, { data: todayRows }] = await Promise.all([
    supabase.from("group_members").select("role, groups(id, name)").eq("user_id", profile.id),
    supabase.rpc("my_today"),
  ]);
  const today = (todayRows ?? []) as TodayItem[];
  const summary = new Map((await getMySummary()).map((r) => [r.group_id, r]));
  const overallStreak = Math.max(0, ...[...summary.values()].map((r) => r.best_streak));

  return (
    <main className="mt-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t("greeting", { name: profile.display_name })}</h1>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-lg font-extrabold ${overallStreak > 0 ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted"}`}
          title={t("streakTitle")}
          aria-label={t("streakLabel", { count: overallStreak })}
        >
          <Flame className="size-5" /> {overallStreak}
        </span>
      </div>

      <section aria-labelledby="today-title">
        <h2 id="today-title" className="mb-2 text-lg font-bold">
          {t("today")}
        </h2>
        {today.length > 0 ? <TodayList items={today} showGroup /> : <Card className="text-muted">{t("todayEmpty")}</Card>}
      </section>

      <section aria-labelledby="groups-title">
        <h2 id="groups-title" className="mb-2 text-lg font-bold">
          {t("myGroups")}
        </h2>
        {groups && groups.length > 0 ? (
          <ul className="space-y-2">
            {groups.map((m) => {
              const g = m.groups as unknown as { id: string; name: string } | null;
              return g ? (
                <li key={g.id}>
                  <Link
                    href={`/g/${g.id}`}
                    className="block rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
                  >
                    <Card className="flex min-h-14 items-center justify-between gap-3 font-semibold">
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      <span className="text-sm text-muted tabular-nums">
                        {t("groupPoints", { points: Math.round(summary.get(g.id)?.total_points ?? 0) })}
                      </span>
                      <ChevronRight className="size-5 text-muted" aria-hidden />
                    </Card>
                  </Link>
                </li>
              ) : null;
            })}
          </ul>
        ) : (
          <Card className="text-muted">{t("noGroups")}</Card>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button asChild size="lg" className="whitespace-nowrap px-3">
            <Link href="/groups/new">
              <Plus />
              {t("createGroup")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="whitespace-nowrap px-3">
            <Link href="/join">
              <Ticket />
              {t("joinGroup")}
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
