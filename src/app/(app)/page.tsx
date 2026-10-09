import { Plus, Ticket } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireOnboardedProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const profile = await requireOnboardedProfile();
  const t = await getTranslations("home");
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("group_members")
    .select("role, groups(id, name)")
    .eq("user_id", profile.id);

  return (
    <main className="mt-6 space-y-6">
      <h1 className="text-2xl font-extrabold">{t("greeting", { name: profile.display_name })}</h1>

      <section aria-labelledby="today-title">
        <h2 id="today-title" className="mb-2 text-lg font-bold">
          {t("today")}
        </h2>
        <Card className="text-muted">{t("todayEmpty")}</Card>
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
                  <Card className="font-semibold">{g.name}</Card>
                </li>
              ) : null;
            })}
          </ul>
        ) : (
          <Card className="text-muted">{t("noGroups")}</Card>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {/* Создание и вступление — этап 2 */}
          <Button size="lg" disabled title={t("soon")}>
            <Plus />
            {t("createGroup")}
          </Button>
          <Button size="lg" variant="secondary" disabled title={t("soon")}>
            <Ticket />
            {t("joinGroup")}
          </Button>
        </div>
      </section>
    </main>
  );
}
