import { Flame } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Character } from "@/components/character";
import { FeedCard, type MemberInfo } from "@/components/feed-card";
import { HabitSummary } from "@/components/habit-summary";
import { Card } from "@/components/ui/card";
import { getArena } from "@/lib/arena";
import { pointsForLevel } from "@/lib/character";
import { getFeed } from "@/lib/feed";
import { getGroupContext, serverNow, todayIn } from "@/lib/group";
import { createClient } from "@/lib/supabase/server";
import type { Habit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EquipPanel } from "./equip-panel";

const LEDGER_PAGE = 50;

type LedgerRow = { id: number; event_type: string; amount: number; reason: string; created_at: string };
type Achievement = { code: string; cosmetic_code: string | null; sort_order: number };

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; userId: string }>;
  searchParams: Promise<{ ledger?: string }>;
}) {
  const { groupId, userId } = await params;
  const ledgerPage = Math.max(0, Number((await searchParams).ledger ?? 0) || 0);
  const { group, members, me, isAdmin } = await getGroupContext(groupId);
  const member = members.find((m) => m.user_id === userId);
  if (!member) notFound();
  const t = await getTranslations("profile");
  const format = await getFormatter();
  const supabase = await createClient();

  const [arena, { data: habits }, { data: ledger, count }, { data: catalog }, { data: earned }, checkins] = await Promise.all([
    getArena(groupId),
    supabase.from("habits").select("*").eq("group_id", groupId).eq("user_id", userId).eq("status", "active").order("created_at"),
    supabase
      .from("points_ledger")
      .select("id, event_type, amount, reason, created_at", { count: "exact" })
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .order("id", { ascending: false })
      .range(ledgerPage * LEDGER_PAGE, ledgerPage * LEDGER_PAGE + LEDGER_PAGE - 1),
    supabase.from("achievements").select("*").order("sort_order"),
    supabase.from("user_achievements").select("achievement_code, group_id").eq("user_id", userId),
    getFeed(groupId, { userId, limit: 10 }),
  ]);
  const a = arena.get(userId);
  const level = a?.level ?? 1;
  const from = pointsForLevel(level);
  const to = pointsForLevel(level + 1);
  const progress = Math.min(100, Math.max(0, (((a?.total_points ?? 0) - from) / (to - from)) * 100));
  const earnedHere = new Set((earned ?? []).filter((e) => e.group_id === groupId).map((e) => e.achievement_code));
  const unlockedAnywhere = new Set((earned ?? []).map((e) => e.achievement_code));
  const achievements = (catalog ?? []) as Achievement[];
  const memberMap: Record<string, MemberInfo> = Object.fromEntries(members.map((m) => [m.user_id, m.profile]));
  const today = todayIn(group.timezone);
  const isMe = userId === me.id;
  const total = count ?? 0;

  return (
    <div className="space-y-6">
      <Card className="flex flex-col items-center text-center">
        <Character seed={member.profile.character_seed} stage={a?.stage} mood={a?.mood} cosmetics={a?.cosmetics} size={160} title={member.profile.display_name} />
        <h2 className="mt-2 text-2xl font-extrabold">{member.profile.display_name}</h2>
        <p className="text-sm text-muted">@{member.profile.nickname}</p>
        <div className="mt-3 w-full max-w-xs">
          <div className="flex justify-between text-xs font-semibold text-muted">
            <span>{t("level", { level })}</span>
            <span>{t("toNext", { points: Math.max(0, Math.ceil(to - (a?.total_points ?? 0))) })}</span>
          </div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={t("levelProgress")}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <dl className="mt-4 grid w-full grid-cols-3 gap-2 text-center">
          <Stat label={t("total")} value={Math.round(a?.total_points ?? 0)} />
          <Stat label={t("season")} value={Math.round(a?.season_points ?? 0)} />
          <Stat label={t("streak")} value={<span className="inline-flex items-center gap-1"><Flame className="size-5 text-primary" />{a?.best_streak ?? 0}</span>} />
        </dl>
      </Card>

      <section>
        <h3 className="mb-2 text-lg font-bold">{t("achievements")}</h3>
        <ul className="grid grid-cols-3 gap-2">
          {achievements.map((ach) => {
            const got = earnedHere.has(ach.code);
            return (
              <li key={ach.code}>
                <Card className={cn("flex h-full flex-col items-center p-3 text-center", !got && "opacity-45 grayscale")}>
                  <span className="text-3xl" aria-hidden>
                    {t(`ach.${ach.code}.icon` as "ach.streak_7.icon")}
                  </span>
                  <p className="mt-1 text-xs font-bold leading-tight">{t(`ach.${ach.code}.title` as "ach.streak_7.title")}</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-muted">{t(`ach.${ach.code}.desc` as "ach.streak_7.desc")}</p>
                  <span className="sr-only">{got ? t("earned") : t("locked")}</span>
                </Card>
              </li>
            );
          })}
        </ul>
        {isMe && <EquipPanel unlocked={achievements.filter((x) => unlockedAnywhere.has(x.code) && x.cosmetic_code).map((x) => x.cosmetic_code!)} equipped={a?.cosmetics ?? {}} />}
      </section>

      <section>
        <h3 className="mb-2 text-lg font-bold">{t("habits")}</h3>
        {(habits ?? []).length === 0 ? (
          <Card className="text-muted">{t("noHabits")}</Card>
        ) : (
          <ul className="space-y-2">
            {((habits ?? []) as Habit[]).map((h) => (
              <li key={h.id}>
                <Card>
                  <HabitSummary habit={h} today={today} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-lg font-bold">{t("ledger")}</h3>
        <p className="mb-2 text-sm text-muted">{t("ledgerHint")}</p>
        {(ledger ?? []).length === 0 ? (
          <Card className="text-muted">{t("ledgerEmpty")}</Card>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {((ledger ?? []) as LedgerRow[]).map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{row.reason}</p>
                    <p className="text-xs text-muted">
                      {t(`event.${row.event_type}` as "event.checkin")} ·{" "}
                      {format.dateTime(new Date(row.created_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className={cn("font-extrabold tabular-nums", Number(row.amount) >= 0 ? "text-accent" : "text-danger")}>
                    {Number(row.amount) > 0 ? "+" : ""}
                    {Number(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {total > LEDGER_PAGE && (
          <div className="mt-2 flex justify-between text-sm font-semibold">
            {ledgerPage > 0 ? <Link className="min-h-11 content-center text-primary" href={`?ledger=${ledgerPage - 1}`}>{t("newer")}</Link> : <span />}
            {(ledgerPage + 1) * LEDGER_PAGE < total && (
              <Link className="min-h-11 content-center text-primary" href={`?ledger=${ledgerPage + 1}`}>
                {t("older")}
              </Link>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-lg font-bold">{t("checkins")}</h3>
        {checkins.length === 0 ? (
          <Card className="text-muted">{t("noCheckins")}</Card>
        ) : (
          <ul className="space-y-4">
            {checkins.map((item) => (
              <li key={item.id}>
                <FeedCard item={item} groupId={groupId} meId={me.id} isAdmin={isAdmin} members={memberMap} now={serverNow()} timezone={group.timezone} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-3">
      <dd className="text-xl font-extrabold tabular-nums">{value}</dd>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
    </div>
  );
}
