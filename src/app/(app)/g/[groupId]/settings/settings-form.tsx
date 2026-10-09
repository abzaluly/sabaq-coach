"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { FormError, Select, SubmitButton } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { COMMON_TIMEZONES, timezoneLabel } from "@/lib/timezones";
import type { Group } from "@/lib/types";
import { updateSettingsAction } from "./actions";

const NUMERIC_RULES = [
  { key: "maxActiveHabits", min: 1, max: 10 },
  { key: "habitApprovalVotes", min: 1, max: 20 },
  { key: "graceMinutes", min: 0, max: 360 },
  { key: "reviewWindowHours", min: 1, max: 72 },
  { key: "confirmationsToApprove", min: 1, max: 10 },
  { key: "collusionWindowDays", min: 1, max: 90 },
  { key: "checkinsPerMinute", min: 1, max: 30 },
] as const;

export function SettingsForm({ group, memberCount }: { group: Group; memberCount: number }) {
  const t = useTranslations("settings");
  const [state, action] = useActionState(updateSettingsAction, undefined);
  const rules = group.pending_changes?.rules ?? group.rules;
  const timezone = group.pending_changes?.timezone ?? group.timezone;
  const zones = COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number]) ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES];

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="group_id" value={group.id} />
      <Card className="space-y-4">
        <div>
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" name="name" defaultValue={group.name} maxLength={60} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="max_members">{t("maxMembers")}</Label>
            <Input id="max_members" name="max_members" type="number" min={Math.max(2, memberCount)} max={50} defaultValue={group.max_members} />
          </div>
          <div>
            <Label htmlFor="season_days">{t("seasonDays")}</Label>
            <Input id="season_days" name="season_days" type="number" min={7} max={365} defaultValue={group.season_days} />
          </div>
        </div>
        <div>
          <Label htmlFor="timezone">{t("timezone")}</Label>
          <Select id="timezone" name="timezone" defaultValue={timezone}>
            {zones.map((tz) => (
              <option key={tz} value={tz}>
                {timezoneLabel(tz)}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-muted">{t("nextPeriodNote")}</p>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-bold">{t("rulesTitle")}</h3>
        <div>
          <Label htmlFor="habitApproval">{t("rules.habitApproval")}</Label>
          <Select id="habitApproval" name="habitApproval" defaultValue={rules.habitApproval}>
            <option value="majority">{t("approvalMajority")}</option>
            <option value="count">{t("approvalCount")}</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          {NUMERIC_RULES.map((r) => (
            <div key={r.key}>
              <Label htmlFor={r.key} className="text-xs">
                {t(`rules.${r.key}`)}
              </Label>
              <Input id={r.key} name={r.key} type="number" inputMode="numeric" min={r.min} max={r.max} defaultValue={rules[r.key]} />
            </div>
          ))}
        </div>
      </Card>

      <FormError state={state} />
      {state?.ok && (
        <p role="status" className="text-sm font-semibold text-accent">
          {t("saved")}
        </p>
      )}
      <SubmitButton size="lg" className="w-full">
        {t("save")}
      </SubmitButton>
    </form>
  );
}
