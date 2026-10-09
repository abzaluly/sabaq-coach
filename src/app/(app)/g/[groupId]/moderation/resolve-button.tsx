"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError, SubmitButton } from "@/components/ui/form";
import { resolveAuditAction } from "../feed/actions";

export function ResolveButton({ groupId, auditId }: { groupId: string; auditId: number }) {
  const t = useTranslations("moderation");
  const [state, action] = useActionState(resolveAuditAction, undefined);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="audit_id" value={auditId} />
      <SubmitButton variant="secondary" className="h-11 text-sm">
        {t("resolve")}
      </SubmitButton>
      <FormError state={state} />
    </form>
  );
}
