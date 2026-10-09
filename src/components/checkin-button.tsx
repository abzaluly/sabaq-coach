"use client";

import { Camera, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import type { RpcErrorCode } from "@/lib/rpc";
import type { ProofType } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  habitId: string;
  proofType: ProofType;
  previousDay?: boolean;
  variant?: "primary" | "link";
  label?: string;
};

/**
 * Отметка за ≤ 2 нажатия: «Отметка» — сразу; «Фото» — кнопка открывает камеру
 * (capture), снимок отправляется автоматически; «Фото + текст» — после снимка поле текста.
 */
export function CheckinButton({ habitId, proofType, previousDay = false, variant = "primary", label }: Props) {
  const t = useTranslations("checkin");
  const te = useTranslations("errors");
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<RpcErrorCode | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function send(file: File | null, text?: string) {
    setState("sending");
    setError(null);
    const body = new FormData();
    body.set("habit_id", habitId);
    if (previousDay) body.set("previous_day", "1");
    if (file) body.set("photo", file);
    if (text) body.set("note", text);
    try {
      const res = await fetch("/api/checkins", { method: "POST", body });
      const json = (await res.json()) as { ok: boolean; error?: RpcErrorCode };
      if (!json.ok) {
        setError(json.error ?? "generic");
        setState("idle");
        return;
      }
      setState("done");
      setPhoto(null);
      if (navigator.vibrate) navigator.vibrate(30);
      setTimeout(() => router.refresh(), 900);
    } catch {
      setError("network");
      setState("idle");
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (proofType === "photo") return void send(file);
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  if (state === "done") {
    return (
      <span role="status" className="inline-flex h-12 animate-[pop_0.5s_ease-out] items-center gap-1.5 rounded-xl bg-accent/20 px-4 font-bold text-fg">
        <Check className="size-5" /> {t("sent")}
      </span>
    );
  }

  if (photo && proofType === "photo_text") {
    return (
      <form
        className="w-full space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(photo, note);
        }}
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- локальный blob-превью
          <img src={preview} alt={t("previewAlt")} className="max-h-48 w-full rounded-xl object-cover" />
        )}
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} required maxLength={500} autoFocus placeholder={t("notePlaceholder")} aria-label={t("noteLabel")} />
        {error && <p role="alert" className="text-sm text-danger">{te(error)}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={() => setPhoto(null)}>
            {t("cancel")}
          </Button>
          <Button type="submit" className="flex-1" disabled={state === "sending" || !note.trim()}>
            {state === "sending" ? <Loader2 className="animate-spin" /> : <Check />}
            {t("done")}
          </Button>
        </div>
      </form>
    );
  }

  const busy = state === "sending";
  const text = label ?? (proofType === "honor" ? t("mark") : t("photo"));
  const classes =
    variant === "link"
      ? "min-h-11 px-1 text-sm font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50"
      : undefined;

  return (
    <div className={cn(variant === "primary" && "flex flex-col items-end gap-1")}>
      {proofType === "honor" ? (
        variant === "link" ? (
          <button type="button" className={classes} disabled={busy} onClick={() => send(null)}>
            {text}
          </button>
        ) : (
          <Button onClick={() => send(null)} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {text}
          </Button>
        )
      ) : (
        <>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={onFile}
            disabled={busy}
            tabIndex={-1}
          />
          {variant === "link" ? (
            <button type="button" className={classes} disabled={busy} onClick={() => inputRef.current?.click()}>
              {text}
            </button>
          ) : (
            <Button onClick={() => inputRef.current?.click()} disabled={busy} aria-busy={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Camera />}
              {busy ? t("uploading") : text}
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="max-w-56 text-right text-sm text-danger">
          {te(error)}
        </p>
      )}
    </div>
  );
}
