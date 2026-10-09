import { getTranslations } from "next-intl/server";
import { Character } from "@/components/character";
import { Card } from "@/components/ui/card";
import { getGroupContext } from "@/lib/group";
import { LeaveGroup } from "./leave-group";

// Этап 2: участники группы. Уровни, очки и стрики на арене — этап 5.
export default async function ArenaPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { members, me } = await getGroupContext(groupId);
  const t = await getTranslations("arena");
  const tr = await getTranslations("roles");

  return (
    <section className="space-y-4">
      <ul className="grid grid-cols-2 gap-3">
        {members.map((m) => (
          <li key={m.user_id}>
            <Card className="flex flex-col items-center p-3 text-center">
              <Character seed={m.profile.character_seed} stage={1} size={88} title={m.profile.display_name} />
              <p className="mt-1 w-full truncate font-bold">{m.profile.display_name}</p>
              <p className="text-xs text-muted">{m.role === "member" ? `@${m.profile.nickname}` : tr(m.role)}</p>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm text-muted">{t("membersCount", { count: members.length })}</p>
      {me.role !== "owner" && <LeaveGroup groupId={groupId} />}
    </section>
  );
}
