import { TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { GroupTabs } from "@/components/group-tabs";
import { getGroupContext } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ groupId: string }> }) {
  const { group } = await getGroupContext((await params).groupId);
  return { title: group.name };
}

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const { group, members, isAdmin, me } = await getGroupContext(groupId);
  const t = await getTranslations("group");
  const supabase = await createClient();
  // Сколько решений ждёт от меня: чужие предложенные привычки без моего голоса.
  const { data: proposed } = await supabase
    .from("habits")
    .select("id, user_id, habit_votes(voter_id)")
    .eq("group_id", groupId)
    .eq("status", "proposed")
    .neq("user_id", me.id);
  const pendingVotes = (proposed ?? []).filter(
    (h) => !(h.habit_votes as { voter_id: string }[]).some((v) => v.voter_id === me.id),
  ).length;

  return (
    <div className="mt-2">
      <BackLink href="/" />
      <h1 className="text-2xl font-extrabold leading-tight">{group.name}</h1>
      {members.length < 3 && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-fg">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          {t("weakVerification")}
        </p>
      )}
      <GroupTabs groupId={groupId} isAdmin={isAdmin} pendingVotes={pendingVotes} />
      <div className="mt-4">{children}</div>
    </div>
  );
}
