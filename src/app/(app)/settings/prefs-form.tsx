"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { FormError, SubmitButton } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { savePrefsAction } from "./actions";

export type Prefs = {
  evening_reminder: boolean;
  reminder_time: string;
  checkin_disputed: boolean;
  weekly_digest: boolean;
  via_push: boolean;
  via_email: boolean;
};

const DEFAULTS: Prefs = {
  evening_reminder: true,
  reminder_time: "20:00",
  checkin_disputed: true,
  weekly_digest: true,
  via_push: true,
  via_email: true,
};

function Toggle({ name, label, hint, defaultChecked }: { name: keyof Prefs; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="peer size-6 shrink-0 accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
      />
    </label>
  );
}

export function PrefsForm({ prefs }: { prefs: Prefs | null }) {
  const t = useTranslations("settingsPage");
  const [state, action] = useActionState(savePrefsAction, undefined);
  const p = { ...DEFAULTS, ...prefs, reminder_time: (prefs?.reminder_time ?? DEFAULTS.reminder_time).slice(0, 5) };

  return (
    <form action={action}>
      <Card className="space-y-2">
        <Toggle name="evening_reminder" label={t("evening")} hint={t("eveningHint")} defaultChecked={p.evening_reminder} />
        <div className="pl-0">
          <Label htmlFor="reminder_time">{t("reminderTime")}</Label>
          <Input id="reminder_time" name="reminder_time" type="time" defaultValue={p.reminder_time} className="max-w-40" />
        </div>
        <Toggle name="checkin_disputed" label={t("disputed")} defaultChecked={p.checkin_disputed} />
        <Toggle name="weekly_digest" label={t("digest")} defaultChecked={p.weekly_digest} />
        <hr className="border-border" />
        <Toggle name="via_push" label={t("viaPush")} defaultChecked={p.via_push} />
        <Toggle name="via_email" label={t("viaEmail")} defaultChecked={p.via_email} />
        <FormError state={state} />
        {state?.ok && (
          <p role="status" className="text-sm font-semibold text-accent">
            {t("saved")}
          </p>
        )}
        <SubmitButton className="w-full">{t("saveNotifications")}</SubmitButton>
      </Card>
    </form>
  );
}
