"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { FormError, SubmitButton } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { joinGroupAction } from "../groups/actions";

export function JoinCodeForm() {
  const t = useTranslations("groups");
  const [state, action] = useActionState(joinGroupAction, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <Card>
        <Label htmlFor="code">{t("code")}</Label>
        <Input
          id="code"
          name="code"
          required
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={8}
          className="text-center text-2xl font-bold uppercase tracking-[0.3em]"
          placeholder="ABCD2345"
        />
      </Card>
      <FormError state={state} />
      <SubmitButton size="lg" className="w-full">
        {t("join")}
      </SubmitButton>
    </form>
  );
}
