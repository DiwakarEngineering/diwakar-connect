"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { email as emailSchema, safeNextPath } from "@/lib/validation";

export function SignInForm({ notice, next }: { notice: string | null; next: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedEmail = emailSchema.safeParse(email);
    const errors: typeof fieldErrors = {};
    if (!parsedEmail.success) errors.email = parsedEmail.error.issues[0]?.message;
    if (!password) errors.password = "Enter your password";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !parsedEmail.success) return;

    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: parsedEmail.data, password });
    if (signInError) {
      setLoading(false);
      setError(friendlyError(signInError, "Sign-in failed. Please try again."));
      return;
    }
    // The app layout re-checks employment status on the server.
    router.replace(safeNextPath(next));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {notice ? (
        <div role="status" className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          {notice}
        </div>
      ) : null}
      <FormError message={error} />
      <Field label="Work email" error={fieldErrors.email}>
        <Input
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@diwakarsolar.com"
          required
        />
      </Field>
      <Field label="Password" error={fieldErrors.password}>
        {(controlProps) => (
          <div className="relative">
            <Input
              {...controlProps}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 hover:text-ink-700"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        )}
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
        Sign in
      </Button>
      <p className="text-center text-xs text-ink-500">
        Accounts are created by your administrator. Need access? Ask your HR or IT team for an invitation.
      </p>
    </form>
  );
}
