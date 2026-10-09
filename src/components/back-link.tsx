import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function BackLink({ href, label }: { href: string; label?: string }) {
  const t = await getTranslations("common");
  return (
    <Link
      href={href}
      className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-5" />
      {label ?? t("back")}
    </Link>
  );
}
