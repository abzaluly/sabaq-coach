"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { emailSchema, normalizePhone, otpSchema } from "@/lib/validation";

const RESEND_SECONDS = 30;
// SMS-вход включается, когда настроен провайдер (см. README → «SMS»).
const SMS_ENABLED = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";

type Channel = "email" | "phone";

export function LoginForm({ linkError, next = "/" }: { linkError?: string; next?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("email");
  const [step, setStep] = useState<"address" | "code">("address");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>(linkError);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const supabase = createClient();
    let result;
    if (channel === "email") {
      const parsed = emailSchema.safeParse(email.trim());
      if (!parsed.success) return setError(t("login.invalidEmail"));
      setPending(true);
      setError(undefined);
      result = await supabase.auth.signInWithOtp({
        email: parsed.data,
        options: { shouldCreateUser: true, emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm` },
      });
    } else {
      const normalized = normalizePhone(phone);
      if (!normalized) return setError(t("login.invalidPhone"));
      setPending(true);
      setError(undefined);
      result = await supabase.auth.signInWithOtp({ phone: normalized, options: { shouldCreateUser: true } });
    }
    setPending(false);
    if (result.error) return setError(t(result.error.status === 429 ? "errors.rate_limited" : "errors.generic"));
    setStep("code");
    setCooldown(RESEND_SECONDS);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    const parsed = otpSchema.safeParse(code.trim());
    if (!parsed.success) return setError(t("login.invalidCode"));
    setPending(true);
    setError(undefined);
    const supabase = createClient();
    const { error } =
      channel === "email"
        ? await supabase.auth.verifyOtp({ email: email.trim(), token: parsed.data, type: "email" })
        : await supabase.auth.verifyOtp({ phone: normalizePhone(phone)!, token: parsed.data, type: "sms" });
    if (error) {
      setPending(false);
      return setError(t("login.linkFailed"));
    }
    router.replace(next);
    router.refresh();
  }

  if (step === "address") {
    return (
      <Card>
        <form onSubmit={sendCode} noValidate>
          <h2 className="text-xl font-bold">{t("login.title")}</h2>
          <p className="mb-5 mt-1 text-sm text-muted">{t(channel === "email" ? "login.subtitle" : "login.subtitlePhone")}</p>
          {SMS_ENABLED && (
            <div role="tablist" aria-label={t("login.channel")} className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {(["email", "phone"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={channel === c}
                  onClick={() => {
                    setChannel(c);
                    setError(undefined);
                  }}
                  className={cn("min-h-11 rounded-lg text-sm font-bold", channel === c ? "bg-surface shadow" : "text-muted")}
                >
                  {t(c === "email" ? "login.emailTab" : "login.phoneTab")}
                </button>
              ))}
            </div>
          )}
          {channel === "email" ? (
            <>
              <Label htmlFor="email">{t("login.emailLabel")}</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                placeholder={t("login.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </>
          ) : (
            <>
              <Label htmlFor="phone">{t("login.phoneLabel")}</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="+7 700 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </>
          )}
          <FieldError id="login-error">{error}</FieldError>
          <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
            {pending ? t("common.loading") : t("login.sendCode")}
          </Button>
          {!SMS_ENABLED && <p className="mt-4 text-center text-xs text-muted">{t("login.phoneSoon")}</p>}
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={verify} noValidate>
        <h2 className="text-xl font-bold">{t("login.codeSentTo", { email: channel === "email" ? email.trim() : normalizePhone(phone) ?? phone })}</h2>
        <p className="mb-5 mt-1 text-sm text-muted">{t(channel === "email" ? "login.codeHint" : "login.codeHintPhone")}</p>
        <Label htmlFor="code">{t(channel === "email" ? "login.codeLabel" : "login.codeLabelPhone")}</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          autoFocus
          className="text-center text-2xl font-bold tracking-[0.5em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "code-error" : undefined}
        />
        <FieldError id="code-error">{error}</FieldError>
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
          {pending ? t("common.loading") : t("login.verify")}
        </Button>
        <div className="mt-3 flex justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStep("address");
              setCode("");
              setError(undefined);
            }}
          >
            {t(channel === "email" ? "login.changeEmail" : "login.changePhone")}
          </Button>
          <Button type="button" variant="ghost" disabled={cooldown > 0 || pending} onClick={() => sendCode()}>
            {cooldown > 0 ? t("login.resendIn", { seconds: cooldown }) : t("login.resend")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
