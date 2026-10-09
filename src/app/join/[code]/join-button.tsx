"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError, SubmitButton } from "@/components/ui/form";
import { joinGroupAction } from "@/app/(app)/groups/actions";

export function JoinButton({ code, full }: { code: string; full: boolean }) {
  const t = useTranslations("groups");
  const [state, action] = useActionState(joinGroupAction, undefined);
  return (
    <form action={action} className="w-full space-y-3">
      <input type="hidden" name="code" value={code} />
      <FormError state={full ? { error: "group_full" } : state} />
      <SubmitButton size="lg" className="w-full" disabled={full}>
        {t("join")}
      </SubmitButton>
    </form>
  );
}
