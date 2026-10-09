import "server-only";
import { signedProofUrls } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CheckinStatus, CheckinVoteKind, HabitFrequency, ProofType } from "@/lib/types";

export type FeedVote = { voter_id: string; vote: CheckinVoteKind; weight: number; comment: string | null; created_at: string };
export type FeedComment = { id: string; user_id: string; body: string; created_at: string };

export type FeedItem = {
  id: string;
  user_id: string;
  habit_id: string;
  local_date: string;
  note: string | null;
  status: CheckinStatus;
  created_at: string;
  review_until: string;
  decision_reason: string | null;
  habit: { title: string; frequency: HabitFrequency; target_count: number; proof_type: ProofType };
  proof: { storage_path: string; flags: string[]; exif_taken_at: string | null; url: string | null } | null;
  votes: FeedVote[];
  reactions: { user_id: string; emoji: string }[];
  comments: FeedComment[];
};

const SELECT = `id, user_id, habit_id, local_date, note, status, created_at, review_until, decision_reason,
  habit:habits(title, frequency, target_count, proof_type),
  proof:proofs(storage_path, flags, exif_taken_at),
  votes:checkin_votes(voter_id, vote, weight, comment, created_at),
  reactions:checkin_reactions(user_id, emoji),
  comments:checkin_comments(id, user_id, body, created_at)`;

export const FEED_PAGE = 20;

/**
 * Лента отметок группы. Строки фильтрует RLS (только мои группы), после чего
 * сервер выдаёт короткоживущие подписанные ссылки на фото.
 */
export async function getFeed(
  groupId: string,
  opts: { before?: string; userId?: string; status?: CheckinStatus; disputedOnly?: boolean; limit?: number } = {},
): Promise<FeedItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("checkins")
    .select(SELECT)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? FEED_PAGE);
  if (opts.before) q = q.lt("created_at", opts.before);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error || !data) return [];

  const rows = data.map((r) => {
    const raw = r as unknown as Omit<FeedItem, "proof" | "habit"> & {
      proof: Omit<NonNullable<FeedItem["proof"]>, "url"> | Omit<NonNullable<FeedItem["proof"]>, "url">[] | null;
      habit: FeedItem["habit"] | FeedItem["habit"][];
    };
    const proof = Array.isArray(raw.proof) ? (raw.proof[0] ?? null) : raw.proof;
    const habit = Array.isArray(raw.habit) ? raw.habit[0]! : raw.habit;
    return {
      ...raw,
      habit,
      proof: proof ? { ...proof, url: null as string | null } : null,
      votes: [...raw.votes].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      comments: [...raw.comments].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    } satisfies FeedItem;
  });

  const items = opts.disputedOnly ? rows.filter((r) => r.votes.some((v) => v.vote === "dispute")) : rows;
  const urls = await signedProofUrls(items.flatMap((i) => (i.proof ? [i.proof.storage_path] : [])));
  for (const item of items) if (item.proof) item.proof.url = urls.get(item.proof.storage_path) ?? null;
  return items;
}
