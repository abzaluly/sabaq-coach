"use client";

import { Bell, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { removePushSubscription, savePushSubscription } from "./actions";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "denied" | "off" | "on";

/** Веб-пуш на этом устройстве. На iOS работает только для PWA, добавленного на экран «Домой». */
export function PushToggle({ vapidKey }: { vapidKey: string }) {
  const t = useTranslations("settingsPage");
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: State;
      if (!vapidKey || !("serviceWorker" in navigator) || !("PushManager" in window)) next = "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const reg = await navigator.serviceWorker.getRegistration();
        next = (await reg?.pushManager.getSubscription()) ? "on" : "off";
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidKey]);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      setState((await savePushSubscription(JSON.stringify(sub.toJSON()))) ? "on" : "off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold">{t("pushTitle")}</p>
        <p className="text-sm text-muted">{t(`push.${state}`)}</p>
      </div>
      {state === "off" && (
        <Button onClick={enable} disabled={busy}>
          <Bell /> {t("pushOn")}
        </Button>
      )}
      {state === "on" && (
        <Button variant="secondary" onClick={disable} disabled={busy}>
          <BellOff /> {t("pushOff")}
        </Button>
      )}
    </Card>
  );
}
