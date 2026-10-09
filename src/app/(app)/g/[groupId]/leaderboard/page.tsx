import { Flame } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Character } from "@/components/character";
import { Card } from "@/components/ui/card";
import { getArena } from "@/lib/arena";
import { getGroupContext } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const SCOPES = ["week", "month", "season", "all"] as const;
type Scope = (typeof SCOPES)[number];

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { groupId } = await params;
  const raw = (await searchParams).scope;
  const scope: Scope = SCOPES.find((s) => s === raw) ?? "season";
  const { members, me } = await getGroupContext(groupId);
  const t = await getTranslations("leaderboard");
  const supabase = await createClient();
  const [{ data }, arena] = await Promise.all([supabase.rpc("leaderboard", { p_group_id: groupId, p_scope: scope }), getArena(groupId)]);
  const rows = (data ?? []) as { user_id: string; points: number; rank: number }[];
  const byId = new Map(members.map((m) => [m.user_id, m.profile]));

  return (
    <section className="space-y-4">
      <nav aria-label={t("scope")} className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1">
        {SCOPES.map((s) => (
          <Link
            key={s}
            href={`?scope=${s}`}
            aria-current={s === scope ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-xl text-sm font-bold",
              s === scope ? "bg-surface text-fg shadow" : "text-muted",
            )}
          >
            {t(`scopes.${s}`)}
          </Link>
        ))}
      </nav>
      <ol className="space-y-2">
        {rows.map((r) => {
          const p = byId.get(r.user_id);
          const a = arena.get(r.user_id);
          if (!p) return null;
          return (
            <li key={r.user_id}>
              <Link href={`/g/${groupId}/u/${r.user_id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring">
                <Card className={cn("flex items-center gap-3 p-3", r.user_id === me.id && "border-primary")}>
                  <span className={cn("w-8 text-center text-xl font-extrabold", Number(r.rank) === 1 ? "text-amber-500" : "text-muted")}>
                    {Number(r.rank) <= 3 ? ["🥇", "🥈", "🥉"][Number(r.rank) - 1] : r.rank}
                  </span>
                  <Character seed={p.character_seed} stage={a?.stage} mood={a?.mood} cosmetics={a?.cosmetics} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{p.display_name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted">
                      {t("level", { level: a?.level ?? 1 })} · <Flame className="size-3" /> {a?.best_streak ?? 0}
                    </p>
                  </div>
                  <span className={cn("text-lg font-extrabold tabular-nums", Number(r.points) < 0 && "text-danger")}>
                    {Math.round(Number(r.points) * 10) / 10}
                  </span>
                </Card>
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="text-center text-xs text-muted">{t("hint")}</p>
    </section>
  );
}
