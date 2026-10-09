import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FeedCard, type MemberInfo } from "@/components/feed-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FEED_PAGE, getFeed } from "@/lib/feed";
import { getGroupContext, serverNow } from "@/lib/group";

export default async function FeedPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { groupId } = await params;
  const { before } = await searchParams;
  const { group, me, members, isAdmin } = await getGroupContext(groupId);
  const t = await getTranslations("feed");
  const items = await getFeed(groupId, { before });
  const now = serverNow();
  const memberMap: Record<string, MemberInfo> = Object.fromEntries(members.map((m) => [m.user_id, m.profile]));

  return (
    <section className="space-y-4">
      <RealtimeRefresh groupId={groupId} tables={["checkins", "checkin_votes", "checkin_comments", "checkin_reactions"]} />
      {items.length === 0 ? (
        <Card className="text-muted">{t("empty")}</Card>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id}>
              <FeedCard item={item} groupId={groupId} meId={me.id} isAdmin={isAdmin} members={memberMap} now={now} timezone={group.timezone} />
            </li>
          ))}
        </ul>
      )}
      {items.length === FEED_PAGE && (
        <Button asChild variant="secondary" className="w-full">
          <Link href={`/g/${groupId}/feed?before=${encodeURIComponent(items.at(-1)!.created_at)}`}>{t("older")}</Link>
        </Button>
      )}
    </section>
  );
}
