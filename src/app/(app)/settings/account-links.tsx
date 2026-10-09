"use client";

import { Mail, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { emailSchema, normalizePhone, otpSchema } from "@/lib/validation";

type Kind = "email" | "phone";

/**
 * Один человек — один аккаунт: к профилю можно привязать и email, и телефон.
 * Supabase Auth гарантирует уникальность (занятый адрес/номер привязать нельзя).
 */
export function AccountLinks({ email, phone, smsEnabled }: { email: string | null; phone: string | null; smsEnabled: boolean }) {
  return (
    <Card className="space-y-4">
      <LinkRow kind="email" current={email} />
      {smsEnabled && <LinkRow kind="phone" current={phone ? `+${phone.replace(/^\+/, "")}` : null} />}
    </Card>
  );
}

function LinkRow({ kind, current }: { kind: Kind; current: string | null }) {
  const t = useTranslations("settingsPage");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"input" | "code">("input");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const Icon = kind === "email" ? Mail : Phone;

  async function request(e: FormEvent) {
    e.preventDefault();
    const normalized = kind === "email" ? (emailSchema.safeParse(value.trim()).success ? value.trim() : null) : normalizePhone(value);
    if (!normalized) return setError(t(kind === "email" ? "invalidEmail" : "invalidPhone"));
    setBusy(true);
    setError(undefined);
    const { error } = await createClient().auth.updateUser(kind === "email" ? { email: normalized } : { phone: normalized });
    setBusy(false);
    // Supabase не раскрывает, кому принадлежит адрес; любая ошибка — «не удалось».
    if (error) return setError(t(error.code === "email_exists" || error.code === "phone_exists" ? "taken" : "linkFailed"));
    setValue(normalized);
    setStep("code");
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!otpSchema.safeParse(code).success) return setError(t("invalidCode"));
    setBusy(true);
    const supabase = createClient();
    const { error } =
      kind === "email"
        ? await supabase.auth.verifyOtp({ email: value, token: code, type: "email_change" })
        : await supabase.auth.verifyOtp({ phone: value, token: code, type: "phone_change" });
    setBusy(false);
    if (error) return setError(t("invalidCode"));
    setOpen(false);
    setStep("input");
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2">
          <Icon className="size-5 shrink-0 text-muted" />
          <span className="truncate">{current ?? <span className="text-muted">{t(kind === "email" ? "noEmail" : "noPhone")}</span>}</span>
        </p>
        {!open && (
          <Button variant="secondary" className="h-11 text-sm" onClick={() => setOpen(true)}>
            {current ? t("change") : t("link")}
          </Button>
        )}
      </div>
      {open && (
        <form onSubmit={step === "input" ? request : confirm} className="mt-3 space-y-2" noValidate>
          {step === "input" ? (
            <>
              <Label htmlFor={`link-${kind}`}>{t(kind === "email" ? "newEmail" : "newPhone")}</Label>
              <Input id={`link-${kind}`} type={kind === "email" ? "email" : "tel"} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </>
          ) : (
            <>
              <Label htmlFor={`code-${kind}`}>{t("codeSent", { to: value })}</Label>
              <Input
                id={`code-${kind}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </>
          )}
          <FieldError>{error}</FieldError>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              {step === "input" ? t("sendCode") : t("confirm")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
