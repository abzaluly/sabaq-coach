import { Flame, Scale, Trophy } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Character } from "@/components/character";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getArena } from "@/lib/arena";
import { getGroupContext } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type Results = {
  season: { id: string; number: number; starts_on: string; ends_on: string; status: string };
  standings: { user_id: string; points: number; checkins: number; misses: number; fakes: number }[];
  best_streaks: { user_id: string; streak: number }[];
  judges: { user_id: string; correct: number; caught: number }[];
};

/** Итоги сезона: подиум, лучшие стрики, «честные судьи», полная таблица. */
export default async function SeasonPage({ params }: { params: Promise<{ groupId: string; seasonId: string }> }) {
  const { groupId, seasonId } = await params;
  const { members, me, season: current } = await getGroupContext(groupId);
  const t = await getTranslations("season");
  const format = await getFormatter();
  const supabase = await createClient();
  const [{ data, error }, arena] = await Promise.all([supabase.rpc("season_results", { p_season_id: seasonId }), getArena(groupId)]);
  if (error || !data) notFound();
  const r = data as Results;
  const byId = new Map(members.map((m) => [m.user_id, m.profile]));
  const name = (id: string) => byId.get(id)?.display_name ?? t("formerMember");
  const podium = r.standings.slice(0, 3);
  const date = (d: string) => format.dateTime(new Date(`${d}T00:00:00`), { day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h2 className="text-2xl font-extrabold">{t("title", { number: r.season.number })}</h2>
        <p className="text-sm text-muted">
          {date(r.season.starts_on)} — {date(r.season.ends_on)} · {r.season.status === "closed" ? t("closed") : t("active")}
        </p>
      </header>

      <ol className="grid grid-cols-3 items-end gap-2" aria-label={t("podium")}>
        {[1, 0, 2].map((i) => {
          const s = podium[i];
          if (!s) return <li key={i} />;
          const p = byId.get(s.user_id);
          const a = arena.get(s.user_id);
          return (
            <li key={s.user_id} className="text-center">
              <Character seed={p?.character_seed ?? s.user_id} stage={a?.stage} mood={i === 0 ? "fire" : undefined} cosmetics={a?.cosmetics} size={i === 0 ? 96 : 72} />
              <div className={cn("mt-1 rounded-t-2xl bg-surface-2 px-1 pb-2 pt-3", i === 0 ? "h-28 bg-amber-400/30" : i === 1 ? "h-20" : "h-16")}>
                <p className="text-2xl">{["🥇", "🥈", "🥉"][i]}</p>
                <p className="truncate text-sm font-bold">{name(s.user_id)}</p>
                <p className="text-xs font-semibold text-muted">{Math.round(Number(s.points))}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <h3 className="mb-2 flex items-center gap-1.5 font-bold">
            <Flame className="size-5 text-primary" /> {t("streaks")}
          </h3>
          {r.best_streaks.length === 0 ? (
            <p className="text-sm text-muted">—</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {r.best_streaks.map((s) => (
                <li key={s.user_id} className="flex justify-between gap-2">
                  <span className="truncate">{name(s.user_id)}</span> <b>{s.streak}</b>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-2 flex items-center gap-1.5 font-bold">
            <Scale className="size-5 text-sky-600" /> {t("judges")}
          </h3>
          {r.judges.length === 0 ? (
            <p className="text-sm text-muted">—</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {r.judges.map((j) => (
                <li key={j.user_id} className="flex justify-between gap-2">
                  <span className="truncate">{name(j.user_id)}</span> <b title={t("caught", { count: j.caught })}>{j.correct}</b>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <caption className="px-4 pt-3 text-left font-bold">{t("table")}</caption>
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">{t("member")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("checkins")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("misses")}</th>
              <th className="px-4 py-2 text-right font-semibold">{t("points")}</th>
            </tr>
          </thead>
          <tbody>
            {r.standings.map((s) => (
              <tr key={s.user_id} className={cn("border-t border-border", s.user_id === me.id && "bg-primary/5")}>
                <td className="px-4 py-2 font-semibold">{name(s.user_id)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.checkins}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.misses + s.fakes}</td>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{Math.round(Number(s.points))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {current && current.id !== r.season.id && (
        <Button asChild size="lg" className="w-full">
          <Link href={`/g/${groupId}`}>
            <Trophy /> {t("toNew", { number: current.number })}
          </Link>
        </Button>
      )}
    </div>
  );
}
