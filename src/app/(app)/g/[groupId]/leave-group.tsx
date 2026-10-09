"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError, SubmitButton } from "@/components/ui/form";
import { leaveGroupAction } from "./settings/actions";

export function LeaveGroup({ groupId }: { groupId: string }) {
  const t = useTranslations("arena");
  const [state, action] = useActionState(leaveGroupAction, undefined);
  return (
    <form
      action={action}
      className="pt-6"
      onSubmit={(e) => {
        if (!window.confirm(t("leaveConfirm"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="group_id" value={groupId} />
      <FormError state={state} />
      <SubmitButton variant="ghost" className="w-full text-danger">
        {t("leave")}
      </SubmitButton>
    </form>
  );
}
