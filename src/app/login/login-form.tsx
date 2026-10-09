"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { emailSchema, otpSchema } from "@/lib/validation";

const RESEND_SECONDS = 30;

export function LoginForm({ linkError }: { linkError?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
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
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) return setError(t("login.invalidEmail"));
    setPending(true);
    setError(undefined);
    const { error } = await createClient().auth.signInWithOtp({
      email: parsed.data,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
      },
    });
    setPending(false);
    if (error) return setError(t("errors.generic"));
    setStep("code");
    setCooldown(RESEND_SECONDS);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    const parsed = otpSchema.safeParse(code.trim());
    if (!parsed.success) return setError(t("login.invalidCode"));
    setPending(true);
    setError(undefined);
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: parsed.data, type: "email" });
    if (error) {
      setPending(false);
      return setError(t("login.linkFailed"));
    }
    router.replace("/");
    router.refresh();
  }

  if (step === "email") {
    return (
      <Card>
        <form onSubmit={sendCode} noValidate>
          <h2 className="text-xl font-bold">{t("login.title")}</h2>
          <p className="mb-5 mt-1 text-sm text-muted">{t("login.subtitle")}</p>
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
          <FieldError id="login-error">{error}</FieldError>
          <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
            {pending ? t("common.loading") : t("login.sendCode")}
          </Button>
          <p className="mt-4 text-center text-xs text-muted">{t("login.phoneSoon")}</p>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={verify} noValidate>
        <h2 className="text-xl font-bold">{t("login.codeSentTo", { email: email.trim() })}</h2>
        <p className="mb-5 mt-1 text-sm text-muted">{t("login.codeHint")}</p>
        <Label htmlFor="code">{t("login.codeLabel")}</Label>
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
              setStep("email");
              setCode("");
              setError(undefined);
            }}
          >
            {t("login.changeEmail")}
          </Button>
          <Button type="button" variant="ghost" disabled={cooldown > 0 || pending} onClick={() => sendCode()}>
            {cooldown > 0 ? t("login.resendIn", { seconds: cooldown }) : t("login.resend")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
