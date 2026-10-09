"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { FormError, SubmitButton } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { saveNameAction } from "./actions";

export function NameForm({ name }: { name: string }) {
  const t = useTranslations("settingsPage");
  const [state, action] = useActionState(saveNameAction, undefined);
  return (
    <Card>
      <form action={action} className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="display_name">{t("name")}</Label>
          <Input id="display_name" name="display_name" defaultValue={name} maxLength={40} required />
        </div>
        <SubmitButton variant="secondary">{t("save")}</SubmitButton>
      </form>
      <FormError state={state} className="mt-2" />
    </Card>
  );
}
