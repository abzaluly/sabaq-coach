"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/actions";
import { cn } from "@/lib/utils";

export function SubmitButton({ children, pendingLabel, ...props }: ComponentProps<typeof Button> & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  const t = useTranslations("common");
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? t("loading")) : children}
    </Button>
  );
}

/** Показывает ошибку из FormState, переведённую через errors.*. */
export function FormError({ state, className }: { state: FormState; className?: string }) {
  const t = useTranslations("errors");
  if (!state?.error) return null;
  return (
    <p role="alert" className={cn("rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger", className)}>
      {t(state.error)}
    </p>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-base text-fg placeholder:text-muted/70",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-base text-fg",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

/** Крупные радиокнопки-«таблетки» (удобные тап-зоны на телефоне). */
export function Segmented<T extends string>({
  name,
  options,
  defaultValue,
  value,
  onChange,
  legend,
}: {
  name: string;
  options: { value: T; label: ReactNode; hint?: ReactNode }[];
  defaultValue?: T;
  value?: T;
  onChange?: (v: T) => void;
  legend: ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-border bg-surface px-2 py-2 text-center text-sm font-semibold",
              "has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ring",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              className="sr-only"
              defaultChecked={value === undefined ? o.value === defaultValue : undefined}
              checked={value === undefined ? undefined : o.value === value}
              onChange={() => onChange?.(o.value)}
            />
            {o.label}
            {o.hint ? <span className="text-xs font-normal text-muted">{o.hint}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
