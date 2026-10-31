"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { NewPasswordFields, validateNewPassword, type PasswordErrors } from "@/components/auth/new-password-fields";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void getSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => setHasSession(!!data.user));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const v = validateNewPassword(password, confirm);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError(friendlyError(updateError, "Couldn't update your password."));
      return;
    }
    await supabase.auth.signOut({ scope: "others" });
    router.replace("/");
    router.refresh();
  }

  return (
    <AuthFrame title="Choose a new password" subtitle="This also signs out your other devices.">
      {hasSession === null ? (
        <LoadingState label="Checking your link" />
      ) : !hasSession ? (
        <div className="space-y-4">
          <FormError message="This reset link is invalid or has expired." />
          <Link href="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError message={error} />
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            errors={errors}
          />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
