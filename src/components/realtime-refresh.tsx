"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Подписка на изменения в группе (Supabase Realtime, RLS учитывается).
 * Любое событие → мягкое обновление серверных компонентов, не чаще раза в 1.5 с.
 * Если Realtime недоступен (например, локальный стек без него) — просто ничего не делает.
 */
export function RealtimeRefresh({ groupId, tables }: { groupId: string; tables: string[] }) {
  const router = useRouter();
  const tableKey = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 1500);
    };
    const channel = supabase.channel(`group:${groupId}`);
    for (const table of tableKey.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `group_id=eq.${groupId}` }, refresh);
    }
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [groupId, router, tableKey]);

  return null;
}
