import { getTranslations } from "next-intl/server";
import { Character } from "@/components/character";
import { FeedCard, type MemberInfo } from "@/components/feed-card";
import { getFeed } from "@/lib/feed";
import { HabitSummary } from "@/components/habit-summary";
import { Card } from "@/components/ui/card";
import { getGroupContext, serverNow, todayIn } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import type { Habit, HabitVote } from "@/lib/types";
import { HabitVoteForm } from "./habit-vote-form";

type ProposedHabit = Habit & { habit_votes: HabitVote[] };

export default async function VotesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { group, me, members, isAdmin } = await getGroupContext(groupId);
  const t = await getTranslations("votes");
  const supabase = await createClient();
  const { data } = await supabase
    .from("habits")
    .select("*, habit_votes(*)")
    .eq("group_id", groupId)
    .eq("status", "proposed")
    .order("created_at");
  const proposed = (data ?? []) as ProposedHabit[];
  const disputed = await getFeed(groupId, { status: "pending", disputedOnly: true, limit: 50 });
  const now = serverNow();
  const memberMap: Record<string, MemberInfo> = Object.fromEntries(members.map((m) => [m.user_id, m.profile]));
  const today = todayIn(group.timezone);
  const byId = new Map(members.map((m) => [m.user_id, m.profile]));
  const others = members.length - 1;
  const needed =
    group.rules.habitApproval === "count" ? Math.min(group.rules.habitApprovalVotes, others) : Math.floor(others / 2) + 1;

  const theirs = proposed.filter((h) => h.user_id !== me.id);
  const mine = proposed.filter((h) => h.user_id === me.id);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-lg font-bold">{t("habitsTitle")}</h2>
        <p className="mb-3 text-sm text-muted">{t("rule", { needed, others })}</p>
        {theirs.length === 0 ? (
          <Card className="text-muted">{t("nothing")}</Card>
        ) : (
          <ul className="space-y-3">
            {theirs.map((h) => {
              const author = byId.get(h.user_id);
              const myVote = h.habit_votes.find((v) => v.voter_id === me.id);
              return (
                <li key={h.id}>
                  <Card>
                    {author && (
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        <Character seed={author.character_seed} size={28} />
                        {author.display_name}
                        {h.replaces_habit_id && <span className="text-xs font-normal text-muted">· {t("change")}</span>}
                      </p>
                    )}
                    <HabitSummary habit={h} today={today} showStatus={false} />
                    <VoteTally votes={h.habit_votes} byId={byId} />
                    <HabitVoteForm groupId={groupId} habitId={h.id} current={myVote?.vote} />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {mine.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-bold">{t("mineTitle")}</h2>
          <ul className="space-y-3">
            {mine.map((h) => (
              <li key={h.id}>
                <Card>
                  <HabitSummary habit={h} today={today} showStatus={false} />
                  <VoteTally votes={h.habit_votes} byId={byId} />
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-bold">{t("disputedTitle")}</h2>
        {disputed.length === 0 ? (
          <Card className="text-muted">{t("noDisputed")}</Card>
        ) : (
          <ul className="space-y-4">
            {disputed.map((item) => (
              <li key={item.id}>
                <FeedCard item={item} groupId={groupId} meId={me.id} isAdmin={isAdmin} members={memberMap} now={now} timezone={group.timezone} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function VoteTally({ votes, byId }: { votes: HabitVote[]; byId: Map<string, { display_name: string }> }) {
  const t = await getTranslations("votes");
  if (votes.length === 0) return <p className="mt-3 text-sm text-muted">{t("noVotes")}</p>;
  const count = (k: HabitVote["vote"]) => votes.filter((v) => v.vote === k).length;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm font-semibold">
        {t("tally", { approve: count("approve"), changes: count("request_changes"), reject: count("reject") })}
      </p>
      {votes
        .filter((v) => v.comment)
        .map((v) => (
          <p key={v.voter_id} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span className="font-semibold">{byId.get(v.voter_id)?.display_name ?? "—"}:</span> {v.comment}
          </p>
        ))}
    </div>
  );
}
