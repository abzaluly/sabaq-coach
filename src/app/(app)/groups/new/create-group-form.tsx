"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { FormError, Segmented, Select, SubmitButton } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { COMMON_TIMEZONES, timezoneLabel } from "@/lib/timezones";
import { createGroupAction } from "../actions";

export function CreateGroupForm() {
  const t = useTranslations("groups");
  const [state, action] = useActionState(createGroupAction, undefined);

  return (
    <form action={action} className="mt-5 space-y-4">
      <Card className="space-y-4">
        <div>
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" name="name" required maxLength={60} placeholder={t("namePlaceholder")} />
        </div>
        <div>
          <Label htmlFor="timezone">{t("timezone")}</Label>
          <Select id="timezone" name="timezone" defaultValue="Asia/Almaty">
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {timezoneLabel(tz)}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-sm text-muted">{t("timezoneHint")}</p>
        </div>
        <Segmented
          name="season_days"
          legend={t("seasonLength")}
          defaultValue="30"
          options={[
            { value: "30", label: t("days", { count: 30 }) },
            { value: "60", label: t("days", { count: 60 }) },
            { value: "90", label: t("days", { count: 90 }) },
          ]}
        />
        <div>
          <Label htmlFor="max_members">{t("maxMembers")}</Label>
          <Input id="max_members" name="max_members" type="number" inputMode="numeric" min={2} max={50} defaultValue={12} />
        </div>
      </Card>
      <FormError state={state} />
      <SubmitButton size="lg" className="w-full">
        {t("create")}
      </SubmitButton>
    </form>
  );
}
