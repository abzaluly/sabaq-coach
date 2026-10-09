import { CheckCircle2, Flame, Shield, Trophy } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Celebrate } from "@/components/celebrate";
import { Character } from "@/components/character";
import { Card } from "@/components/ui/card";
import { getArena } from "@/lib/arena";
import { getGroupContext } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { LeaveGroup } from "./leave-group";

/** Арена: персонажи всех участников, уровень, очки сезона, стрик, кто сегодня всё сделал. */
export default async function ArenaPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { members, me, season } = await getGroupContext(groupId);
  const supabase = await createClient();
  const [arena, { data: lastClosed }] = await Promise.all([
    getArena(groupId),
    supabase.from("seasons").select("id, number, closed_at").eq("group_id", groupId).eq("status", "closed").order("number", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const t = await getTranslations("arena");
  const format = await getFormatter();
  const sorted = [...members].sort((a, b) => (arena.get(b.user_id)?.season_points ?? 0) - (arena.get(a.user_id)?.season_points ?? 0));
  const mine = arena.get(me.id);

  return (
    <section className="space-y-4">
      {mine && <Celebrate scope={groupId} level={mine.level} streak={mine.best_streak} points={mine.total_points} />}
      {lastClosed && (
        <Link
          href={`/g/${groupId}/season/${lastClosed.id}`}
          className="flex min-h-12 items-center gap-2 rounded-2xl bg-amber-400/25 px-4 py-3 font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
        >
          <Trophy className="size-5 text-amber-600" /> {t("seasonResults", { number: lastClosed.number })}
        </Link>
      )}
      {season && <p className="text-sm font-semibold text-muted">{t("season", { number: season.number, ends: format.dateTime(new Date(`${season.ends_on}T00:00:00`), { day: "numeric", month: "long" }) })}</p>}
      <ul className="grid grid-cols-2 gap-3">
        {sorted.map((m) => {
          const a = arena.get(m.user_id);
          return (
            <li key={m.user_id}>
              <Link href={`/g/${groupId}/u/${m.user_id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring">
                <Card className={cn("relative flex flex-col items-center p-3 text-center", m.user_id === me.id && "border-primary")}>
                  {a?.allDoneToday && (
                    <CheckCircle2 className="absolute right-2 top-2 size-6 text-accent" aria-label={t("allDone")} />
                  )}
                  <Character
                    seed={m.profile.character_seed}
                    stage={a?.stage ?? 0}
                    mood={a?.mood}
                    cosmetics={a?.cosmetics}
                    size={96}
                    title={m.profile.display_name}
                  />
                  <p className="mt-1 w-full truncate font-bold">{m.profile.display_name}</p>
                  <p className="text-xs font-semibold text-muted">{t("level", { level: a?.level ?? 1 })}</p>
                  <div className="mt-2 flex items-center gap-3 text-sm font-bold">
                    <span>{t("points", { points: Math.round(a?.season_points ?? 0) })}</span>
                    {a?.frozen_today ? (
                      <span className="inline-flex items-center gap-0.5 text-sky-600" title={t("frozen")}>
                        <Shield className="size-4" /> {a.best_streak}
                      </span>
                    ) : (
                      <span className={cn("inline-flex items-center gap-0.5", (a?.best_streak ?? 0) > 0 ? "text-primary" : "text-muted")} title={t("streak")}>
                        <Flame className="size-4" /> {a?.best_streak ?? 0}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-center text-sm text-muted">{t("membersCount", { count: members.length })}</p>
      {me.role !== "owner" && <LeaveGroup groupId={groupId} />}
    </section>
  );
}
