import { CheckCircle2, Clock, Shield } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CheckinButton } from "@/components/checkin-button";
import { Card } from "@/components/ui/card";
import type { HabitDifficulty, HabitFrequency, ProofType } from "@/lib/types";

export type TodayItem = {
  habit_id: string;
  group_id: string;
  group_name: string;
  title: string;
  frequency: HabitFrequency;
  target_count: number;
  proof_type: ProofType;
  difficulty: HabitDifficulty;
  local_date: string;
  period_start: string;
  period_end: string;
  done_count: number;
  pending_count: number;
  checked_today: boolean;
  frozen_today: boolean;
  can_previous_day: boolean;
};

/** Сегодняшние привычки с кнопкой отметки. showGroup — для главной (несколько групп). */
export async function TodayList({ items, showGroup }: { items: TodayItem[]; showGroup: boolean }) {
  const t = await getTranslations("checkin");
  if (items.length === 0) return null;

  return (
    <ul className="space-y-2">
      {items.map((h) => {
        const complete = h.done_count >= h.target_count;
        const doneToday = h.checked_today || complete;
        return (
          <li key={h.habit_id}>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {showGroup && (
                    <Link href={`/g/${h.group_id}`} className="text-xs font-semibold text-muted hover:underline">
                      {h.group_name}
                    </Link>
                  )}
                  <p className="truncate font-bold">{h.title}</p>
                  <Progress done={h.done_count} target={h.target_count} frequency={h.frequency} pending={h.pending_count} />
                </div>
                {h.frozen_today ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-muted">
                    <Shield className="size-4" /> {t("frozen")}
                  </span>
                ) : doneToday ? (
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-accent" aria-label={t("doneToday")}>
                    {h.pending_count > 0 ? <Clock className="size-5" /> : <CheckCircle2 className="size-5" />}
                    {complete && h.target_count > 1 ? t("periodDone") : t("doneShort")}
                  </span>
                ) : (
                  <CheckinButton habitId={h.habit_id} proofType={h.proof_type} />
                )}
              </div>
              {h.can_previous_day && !h.frozen_today && (
                <div className="mt-1 flex justify-end">
                  <CheckinButton habitId={h.habit_id} proofType={h.proof_type} previousDay variant="link" label={t("yesterday")} />
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

async function Progress({ done, target, frequency, pending }: { done: number; target: number; frequency: HabitFrequency; pending: number }) {
  const t = await getTranslations("checkin");
  if (target === 1 && frequency === "daily") {
    return pending > 0 ? <p className="text-xs text-muted">{t("onReview")}</p> : null;
  }
  return (
    <div className="mt-1 flex items-center gap-2">
      {target <= 7 ? (
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: target }, (_, i) => (
            <span key={i} className={`h-2 w-5 rounded-full ${i < done ? "bg-accent" : "bg-surface-2"}`} />
          ))}
        </div>
      ) : (
        <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
        </div>
      )}
      <span className="text-xs text-muted">{t(frequency === "weekly" ? "progressWeek" : "progressMonth", { done, target })}</span>
    </div>
  );
}
