import { Camera, CameraOff, FileText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { Habit } from "@/lib/types";
import { cn } from "@/lib/utils";

export function frequencyLabel(t: ReturnType<typeof useTranslations<"habits">>, h: Pick<Habit, "frequency" | "target_count">) {
  if (h.frequency === "daily") return t("freq.daily");
  return t(h.frequency === "weekly" ? "perWeek" : "perMonth", { count: h.target_count });
}

const proofIcons = { photo: Camera, photo_text: FileText, honor: CameraOff } as const;

/** Компактное описание привычки: частота, пруф, сложность, статус. */
export function HabitSummary({ habit, today, showStatus = true }: { habit: Habit; today: string; showStatus?: boolean }) {
  const t = useTranslations("habits");
  const format = useFormatter();
  const ProofIcon = proofIcons[habit.proof_type];
  const date = (d: string) => format.dateTime(new Date(`${d}T00:00:00`), { day: "numeric", month: "short" });

  let status: { label: string; tone: string } | null = null;
  if (habit.status === "proposed") status = { label: t("status.proposed"), tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  else if (habit.status === "rejected") status = { label: t("status.rejected"), tone: "bg-danger/10 text-danger" };
  else if (habit.status === "archived" || (habit.active_until && habit.active_until <= today))
    status = { label: t("status.ended"), tone: "bg-surface-2 text-muted" };
  else if (habit.active_from && habit.active_from > today)
    status = { label: t("status.startsOn", { date: date(habit.active_from) }), tone: "bg-accent/15 text-fg" };
  else if (habit.active_until) status = { label: t("status.endsOn", { date: date(habit.active_until) }), tone: "bg-surface-2 text-muted" };

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold leading-snug">{habit.title}</h3>
        {showStatus && status && (
          <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", status.tone)}>{status.label}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{habit.description}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-muted">
        <span>{frequencyLabel(t, habit)}</span>
        <span className="inline-flex items-center gap-1">
          <ProofIcon className="size-3.5" aria-hidden />
          {t(`proofType.${habit.proof_type}`)}
        </span>
        <span>{t(`diff.${habit.difficulty}`)}</span>
      </p>
    </div>
  );
}
