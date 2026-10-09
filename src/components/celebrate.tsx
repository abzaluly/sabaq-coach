"use client";

import { Flame, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type Snapshot = { level: number; streak: number; points: number };

/**
 * Анимации прогресса: сравнивает текущие уровень/стрик/очки с тем, что пользователь
 * видел в прошлый раз (localStorage), и показывает праздничную плашку один раз.
 */
export function Celebrate({ scope, level, streak, points }: Snapshot & { scope: string }) {
  const t = useTranslations("celebrate");
  const [events, setEvents] = useState<{ kind: "level" | "streak" | "points"; value: number }[]>([]);

  useEffect(() => {
    const key = `orle-seen:${scope}`;
    let prev: Snapshot | null = null;
    try {
      prev = JSON.parse(localStorage.getItem(key) ?? "null") as Snapshot | null;
      localStorage.setItem(key, JSON.stringify({ level, streak, points }));
    } catch {
      return;
    }
    if (!prev) return;
    const next: typeof events = [];
    if (level > prev.level) next.push({ kind: "level", value: level });
    if (streak > prev.streak) next.push({ kind: "streak", value: streak });
    const delta = Math.round((points - prev.points) * 100) / 100;
    if (delta !== 0) next.push({ kind: "points", value: delta });
    if (next.length === 0) return;
    // Показ событий — синхронизация с внешним хранилищем (localStorage), ровно один раз.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents(next);
    const timer = setTimeout(() => setEvents([]), 4500);
    return () => clearTimeout(timer);
  }, [scope, level, streak, points]);

  if (events.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      {events.map((e) => (
        <div
          key={e.kind}
          className="flex animate-[pop_0.6s_ease-out] items-center gap-2 rounded-2xl bg-fg px-5 py-3 text-lg font-extrabold text-bg shadow-lg"
        >
          {e.kind === "level" && (
            <>
              <Sparkles className="size-6 text-amber-300" /> {t("level", { level: e.value })}
            </>
          )}
          {e.kind === "streak" && (
            <>
              <Flame className="size-6 animate-pulse text-orange-400" /> {t("streak", { streak: e.value })}
            </>
          )}
          {e.kind === "points" && (
            <span className={e.value > 0 ? "text-emerald-300" : "text-red-300"}>
              {e.value > 0 ? `+${e.value}` : e.value} {t("points")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
