"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Card } from "@/components/ui/card";
import { FormError, Segmented, SubmitButton, Textarea } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import type { FormState } from "@/lib/actions";
import { basePoints, perCheckinPoints } from "@/lib/scoring";
import type { Habit, HabitDifficulty, HabitFrequency, ProofType, Scoring } from "@/lib/types";

type Props = {
  groupId: string;
  scoring: Scoring;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  initial?: Partial<Habit>;
  habitId?: string;
  replacesHabitId?: string;
  submitLabel: string;
};

export function HabitForm({ groupId, scoring, action, initial, habitId, replacesHabitId, submitLabel }: Props) {
  const t = useTranslations("habits");
  const [state, formAction] = useActionState(action, undefined);
  const [frequency, setFrequency] = useState<HabitFrequency>(initial?.frequency ?? "daily");
  const [target, setTarget] = useState(initial?.target_count ?? 3);
  const [proof, setProof] = useState<ProofType>(initial?.proof_type ?? "photo");
  const [difficulty, setDifficulty] = useState<HabitDifficulty>(initial?.difficulty ?? "medium");

  const habit = { frequency, difficulty, proof_type: proof, target_count: frequency === "daily" ? 1 : target };
  const maxTarget = frequency === "weekly" ? 7 : 28;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="group_id" value={groupId} />
      {habitId && <input type="hidden" name="habit_id" value={habitId} />}
      {replacesHabitId && <input type="hidden" name="replaces_habit_id" value={replacesHabitId} />}

      <Card className="space-y-4">
        <div>
          <Label htmlFor="title">{t("title")}</Label>
          <Input id="title" name="title" required minLength={3} maxLength={80} defaultValue={initial?.title} placeholder={t("titlePlaceholder")} />
        </div>
        <div>
          <Label htmlFor="description">{t("description")}</Label>
          <Textarea
            id="description"
            name="description"
            required
            minLength={10}
            maxLength={500}
            defaultValue={initial?.description}
            placeholder={t("descriptionPlaceholder")}
            aria-describedby="description-hint"
          />
          <p id="description-hint" className="mt-1.5 text-sm text-muted">
            {t("descriptionHint")}
          </p>
        </div>
      </Card>

      <Card className="space-y-4">
        <Segmented
          name="frequency"
          legend={t("frequency")}
          value={frequency}
          onChange={setFrequency}
          options={[
            { value: "daily", label: t("freq.daily") },
            { value: "weekly", label: t("freq.weekly") },
            { value: "monthly", label: t("freq.monthly") },
          ]}
        />
        {frequency !== "daily" && (
          <div>
            <Label htmlFor="target_count">{t(frequency === "weekly" ? "timesPerWeek" : "timesPerMonth")}</Label>
            <Input
              id="target_count"
              name="target_count"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxTarget}
              value={target}
              onChange={(e) => setTarget(Math.max(1, Math.min(maxTarget, Number(e.target.value) || 1)))}
            />
          </div>
        )}
        <Segmented
          name="proof_type"
          legend={t("proof")}
          value={proof}
          onChange={setProof}
          options={[
            { value: "photo", label: t("proofType.photo") },
            { value: "photo_text", label: t("proofType.photo_text") },
            { value: "honor", label: t("proofType.honor"), hint: t("honorHint", { pct: Math.round(scoring.honorMultiplier * 100) }) },
          ]}
        />
        <Segmented
          name="difficulty"
          legend={t("difficulty")}
          value={difficulty}
          onChange={setDifficulty}
          options={[
            { value: "easy", label: t("diff.easy"), hint: `×${scoring.difficulty.easy}` },
            { value: "medium", label: t("diff.medium"), hint: `×${scoring.difficulty.medium}` },
            { value: "hard", label: t("diff.hard"), hint: `×${scoring.difficulty.hard}` },
          ]}
        />
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm" aria-live="polite">
          {habit.target_count > 1
            ? t("pointsPreviewN", { base: basePoints(scoring, habit), each: perCheckinPoints(scoring, habit) })
            : t("pointsPreview", { base: basePoints(scoring, habit) })}
        </p>
      </Card>

      <p className="text-sm text-muted">{t("approvalNote")}</p>
      <FormError state={state} />
      <SubmitButton size="lg" className="w-full">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
