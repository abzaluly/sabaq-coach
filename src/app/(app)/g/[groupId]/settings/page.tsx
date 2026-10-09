import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getGroupContext } from "@/lib/group";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Invite } from "@/lib/types";
import { InvitesPanel } from "./invites-panel";
import { MembersPanel } from "./members-panel";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { group, isAdmin, members, me } = await getGroupContext(groupId);
  if (!isAdmin) notFound();
  const t = await getTranslations("settings");
  const supabase = await createClient();
  const { data } = await supabase
    .from("invites")
    .select("*")
    .eq("group_id", groupId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const invites = usableInvites((data ?? []) as Invite[]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-lg font-bold">{t("invitesTitle")}</h2>
        <InvitesPanel groupId={groupId} invites={invites} siteUrl={publicEnv.NEXT_PUBLIC_SITE_URL} />
      </section>
      <section>
        <h2 className="mb-2 text-lg font-bold">{t("membersTitle")}</h2>
        <MembersPanel groupId={groupId} members={members} myId={me.id} myRole={me.role} />
      </section>
      <section>
        <h2 className="mb-2 text-lg font-bold">{t("groupTitle")}</h2>
        {group.pending_changes && (
          <Card className="mb-3 text-sm">{t("pendingNote", { date: group.pending_effective_from ?? "" })}</Card>
        )}
        <SettingsForm group={group} memberCount={members.length} />
      </section>
    </div>
  );
}

function usableInvites(list: Invite[], now = new Date()): Invite[] {
  return list.filter(
    (i) => (!i.expires_at || new Date(i.expires_at) > now) && (i.max_uses === null || i.uses < i.max_uses),
  );
}
