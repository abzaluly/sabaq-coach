"use client";

import { Shield } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError, SubmitButton } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";
import { cancelFreezeAction, declareFreezeAction } from "./actions";

export type FreezeRow = { id: string; starts_on: string; ends_on: string; reason: string };

/** Заморозка: объявляется заранее, видна всей группе, 1–2 раза за сезон. */
export function FreezePanel({
  groupId,
  freezes,
  used,
  limit,
  tomorrow,
}: {
  groupId: string;
  freezes: FreezeRow[];
  used: number;
  limit: number;
  tomorrow: string;
}) {
  const t = useTranslations("freeze");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(declareFreezeAction, undefined);
  const [, cancel] = useActionState(cancelFreezeAction, undefined);
  const date = (d: string) => format.dateTime(new Date(`${d}T00:00:00`), { day: "numeric", month: "short" });

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <Shield className="size-5 text-sky-600" /> {t("title")}
        </h2>
        <span className="text-sm text-muted">{t("used", { used, limit })}</span>
      </div>
      <p className="text-sm text-muted">{t("hint")}</p>
      {freezes.length > 0 && (
        <ul className="space-y-1">
          {freezes.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span>
                {date(f.starts_on)}
                {f.ends_on !== f.starts_on && ` — ${date(f.ends_on)}`} · {f.reason}
              </span>
              {f.starts_on >= tomorrow && (
                <form action={cancel}>
                  <input type="hidden" name="group_id" value={groupId} />
                  <input type="hidden" name="freeze_id" value={f.id} />
                  <SubmitButton variant="ghost" className="h-11 px-2 text-sm">
                    {t("cancel")}
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {used < limit &&
        (open ? (
          <form action={action} className="space-y-3">
            <input type="hidden" name="group_id" value={groupId} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="starts_on">{t("from")}</Label>
                <Input id="starts_on" name="starts_on" type="date" min={tomorrow} defaultValue={tomorrow} required />
              </div>
              <div>
                <Label htmlFor="ends_on">{t("to")}</Label>
                <Input id="ends_on" name="ends_on" type="date" min={tomorrow} defaultValue={tomorrow} required />
              </div>
            </div>
            <div>
              <Label htmlFor="reason">{t("reason")}</Label>
              <Input id="reason" name="reason" required maxLength={200} placeholder={t("reasonPlaceholder")} />
            </div>
            <FormError state={state} />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <SubmitButton className="flex-1">{t("declare")}</SubmitButton>
            </div>
          </form>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
            {t("open")}
          </Button>
        ))}
    </Card>
  );
}
