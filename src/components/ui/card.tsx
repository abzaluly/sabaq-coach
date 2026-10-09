import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-2xl border border-border bg-surface p-5 shadow-[0_2px_0_0_var(--border)]", className)}
      {...props}
    />
  );
}
