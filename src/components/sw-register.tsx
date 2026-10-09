"use client";

import { useEffect } from "react";

/** Регистрирует service worker (PWA, офлайн-страница, пуш). Только в продакшен-сборке. */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // без SW приложение работает как обычный сайт
    });
  }, []);
  return null;
}
