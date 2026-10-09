"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function GroupTabs({ groupId, isAdmin, pendingVotes }: { groupId: string; isAdmin: boolean; pendingVotes: number }) {
  const t = useTranslations("group.tabs");
  const pathname = usePathname();
  const base = `/g/${groupId}`;
  const tabs = [
    { href: base, label: t("arena") },
    { href: `${base}/feed`, label: t("feed") },
    { href: `${base}/habits`, label: t("habits") },
    { href: `${base}/votes`, label: t("votes"), badge: pendingVotes },
    { href: `${base}/leaderboard`, label: t("leaderboard") },
    ...(isAdmin
      ? [
          { href: `${base}/moderation`, label: t("moderation") },
          { href: `${base}/settings`, label: t("settings") },
        ]
      : []),
  ];

  return (
    <nav aria-label={t("label")} className="-mx-4 mt-3 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul className="flex gap-2">
        {tabs.map((tab) => {
          const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-bold transition",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
                  active ? "bg-fg text-bg" : "bg-surface-2 text-fg hover:brightness-95",
                )}
              >
                {tab.label}
                {tab.badge ? (
                  <span className="rounded-full bg-primary px-1.5 text-xs text-primary-fg" aria-label={t("pending", { count: tab.badge })}>
                    {tab.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
