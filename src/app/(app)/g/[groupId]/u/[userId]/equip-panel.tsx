"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form";
import type { Cosmetics } from "@/lib/character";
import { cn } from "@/lib/utils";
import { equipAction } from "./actions";

const KIND_OF: Record<string, keyof Cosmetics> = {
  frame_ember: "frame",
  frame_gold: "frame",
  bg_meadow: "background",
  bg_aurora: "background",
  acc_scarf: "accessory",
  acc_crown: "accessory",
  acc_gavel: "accessory",
};

export function EquipPanel({ unlocked, equipped }: { unlocked: string[]; equipped: Cosmetics }) {
  const t = useTranslations("profile");
  const [state, action] = useActionState(equipAction, undefined);
  if (unlocked.length === 0) return <p className="mt-2 text-sm text-muted">{t("cosmeticsHint")}</p>;

  return (
    <Card className="mt-3">
      <h4 className="mb-2 font-bold">{t("cosmetics")}</h4>
      <form action={action} className="flex flex-wrap gap-2">
        {unlocked.map((code) => {
          const kind = KIND_OF[code]!;
          const on = equipped[kind] === code;
          return (
            <button
              key={code}
              type="submit"
              name="choice"
              value={`${kind}:${on ? "" : code}`}
              aria-pressed={on}
              className={cn(
                "min-h-11 rounded-full border-2 px-4 text-sm font-semibold",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
                on ? "border-primary bg-primary/10" : "border-border",
              )}
            >
              {t(`cosmetic.${code}` as "cosmetic.frame_ember")}
            </button>
          );
        })}
      </form>
      <FormError state={state} className="mt-2" />
    </Card>
  );
}
