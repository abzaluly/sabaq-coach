"use client";

import { Check, MessageSquareWarning, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, SubmitButton, Textarea } from "@/components/ui/form";
import type { HabitVoteKind } from "@/lib/types";
import { voteHabitAction } from "../habits/actions";

export function HabitVoteForm({ groupId, habitId, current }: { groupId: string; habitId: string; current?: HabitVoteKind }) {
  const t = useTranslations("votes");
  const [state, action] = useActionState(voteHabitAction, undefined);
  const [mode, setMode] = useState<"approve" | "request_changes" | "reject" | null>(null);

  if (mode && mode !== "approve") {
    return (
      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="habit_id" value={habitId} />
        <input type="hidden" name="vote" value={mode} />
        <Textarea name="comment" required autoFocus maxLength={500} placeholder={t(mode === "reject" ? "rejectPlaceholder" : "changesPlaceholder")} />
        <FormError state={state} />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={() => setMode(null)}>
            {t("cancel")}
          </Button>
          <SubmitButton className="flex-1" variant={mode === "reject" ? "danger" : "primary"}>
            {t("send")}
          </SubmitButton>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="habit_id" value={habitId} />
      <input type="hidden" name="vote" value="approve" />
      {current && <p className="text-xs font-semibold text-muted">{t("yourVote", { vote: t(`kind.${current}`) })}</p>}
      <div className="grid grid-cols-3 gap-2">
        <SubmitButton aria-pressed={current === "approve"}>
          <Check />
          {t("approve")}
        </SubmitButton>
        <Button type="button" variant="secondary" onClick={() => setMode("request_changes")} aria-pressed={current === "request_changes"}>
          <MessageSquareWarning />
          {t("requestChanges")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setMode("reject")} aria-pressed={current === "reject"}>
          <X />
          {t("reject")}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}
