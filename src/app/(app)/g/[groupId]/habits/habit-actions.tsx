"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, SubmitButton } from "@/components/ui/form";
import type { Habit } from "@/lib/types";
import { archiveHabitAction } from "./actions";

export function HabitActions({
  groupId,
  habit,
  today,
  changePending,
}: {
  groupId: string;
  habit: Habit;
  today: string;
  changePending: boolean;
}) {
  const t = useTranslations("habits");
  const [state, action] = useActionState(archiveHabitAction, undefined);
  const ending = Boolean(habit.active_until);
  const canChange = habit.status === "active" && !ending && !changePending;
  const editHref =
    habit.status === "proposed"
      ? `/g/${groupId}/habits/new?edit=${habit.id}`
      : `/g/${groupId}/habits/new?replaces=${habit.id}`;

  if (ending) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        {(habit.status === "proposed" || canChange) && (
          <Button asChild variant="secondary" className="flex-1">
            <Link href={editHref}>
              <Pencil />
              {habit.status === "proposed" ? t("edit") : t("change")}
            </Link>
          </Button>
        )}
        <form
          action={action}
          className="flex-1"
          onSubmit={(e) => {
            const msg = habit.status === "active" && habit.active_from && habit.active_from <= today ? t("archiveConfirmActive") : t("archiveConfirm");
            if (!window.confirm(msg)) e.preventDefault();
          }}
        >
          <input type="hidden" name="group_id" value={groupId} />
          <input type="hidden" name="habit_id" value={habit.id} />
          <SubmitButton variant="ghost" className="w-full text-danger">
            <Trash2 />
            {habit.status === "proposed" ? t("withdraw") : t("archive")}
          </SubmitButton>
        </form>
      </div>
      {changePending && <p className="text-xs text-muted">{t("changePending")}</p>}
      <FormError state={state} />
    </div>
  );
}
