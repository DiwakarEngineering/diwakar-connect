"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { email as emailSchema } from "@/lib/validation";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    setFieldError(null);
    setLoading(true);
    const { error: resetError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    // Don't reveal whether the address has an account; only surface transport errors.
    if (resetError && /rate limit|fetch|network/i.test(resetError.message)) {
      setError(friendlyError(resetError));
      return;
    }
    setSent(true);
  }

  return (
    <AuthFrame title="Reset your password" subtitle="We'll email you a secure link to choose a new password.">
      {sent ? (
        <div role="status" className="rounded-xl border border-line bg-canvas p-5 text-center">
          <MailCheck className="mx-auto h-8 w-8 text-brand-600" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink-900">Check your inbox</p>
          <p className="mt-1 text-sm text-ink-500">
            If <span className="font-medium text-ink-700">{email}</span> has a Diwakar Connect account, a reset link is on its way.
            The link expires after a short time.
          </p>
          <Link href="/sign-in" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError message={error} />
          <Field label="Work email" error={fieldError}>
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Send reset link
          </Button>
          <p className="text-center">
            <Link href="/sign-in" className="text-sm font-medium text-brand-700 hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
