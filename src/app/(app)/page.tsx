import { ChevronRight, Plus, Ticket } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TodayList, type TodayItem } from "@/components/today-list";
import { Card } from "@/components/ui/card";
import { requireOnboardedProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const profile = await requireOnboardedProfile();
  const t = await getTranslations("home");
  const supabase = await createClient();
  const [{ data: groups }, { data: todayRows }] = await Promise.all([
    supabase.from("group_members").select("role, groups(id, name)").eq("user_id", profile.id),
    supabase.rpc("my_today"),
  ]);
  const today = (todayRows ?? []) as TodayItem[];

  return (
    <main className="mt-6 space-y-6">
      <h1 className="text-2xl font-extrabold">{t("greeting", { name: profile.display_name })}</h1>

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
                    <Card className="flex min-h-14 items-center justify-between font-semibold">
                      {g.name}
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
          <Button asChild size="lg">
            <Link href="/groups/new">
              <Plus />
              {t("createGroup")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
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
