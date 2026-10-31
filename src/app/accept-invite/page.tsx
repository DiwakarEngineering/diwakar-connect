"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { NewPasswordFields, validateNewPassword, type PasswordErrors } from "@/components/auth/new-password-fields";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { displayName as displayNameSchema } from "@/lib/validation";

type State =
  | { kind: "loading" }
  | { kind: "no-session" }
  | { kind: "not-invited"; status: string }
  | { kind: "ready"; email: string; name: string; userId: string };

export default function AcceptInvitePage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors & { name?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return setState({ kind: "no-session" });
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, employment_status")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!profile) return setState({ kind: "not-invited", status: "missing" });
      if (profile.employment_status === "active") {
        router.replace("/");
        return;
      }
      if (profile.employment_status !== "invited") return setState({ kind: "not-invited", status: profile.employment_status });
      setName(profile.display_name);
      setState({ kind: "ready", email: data.user.email ?? "", name: profile.display_name, userId: data.user.id });
    })();
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (state.kind !== "ready") return;
    setError(null);
    const v: PasswordErrors & { name?: string } = validateNewPassword(password, confirm);
    const parsedName = displayNameSchema.safeParse(name);
    if (!parsedName.success) v.name = parsedName.error.issues[0]?.message;
    setErrors(v);
    if (Object.keys(v).length > 0 || !parsedName.success) return;

    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error: pwError } = await supabase.auth.updateUser({ password, data: { display_name: parsedName.data } });
    if (pwError) {
      setLoading(false);
      setError(friendlyError(pwError, "Couldn't set your password."));
      return;
    }
    const { data: status, error: activateError } = await supabase.rpc("activate_my_account");
    if (activateError || status !== "active") {
      setLoading(false);
      setError(friendlyError(activateError, "Your account couldn't be activated. Contact your administrator."));
      return;
    }
    if (parsedName.data !== state.name) {
      await supabase.from("profiles").update({ display_name: parsedName.data }).eq("id", state.userId);
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <AuthFrame title="Welcome to Diwakar Connect" subtitle="Confirm your name and choose a password to finish setting up.">
      {state.kind === "loading" ? (
        <LoadingState label="Checking your invitation" />
      ) : state.kind === "no-session" ? (
        <div className="space-y-4">
          <FormError message="This invitation link is invalid or has expired. Ask your administrator to resend it." />
          <Link href="/sign-in" className="text-sm font-medium text-brand-700 hover:underline">
            Go to sign in
          </Link>
        </div>
      ) : state.kind === "not-invited" ? (
        <div className="space-y-4">
          <FormError
            message={
              state.status === "missing"
                ? "Your account isn't set up yet. Contact your administrator."
                : "This account is not active. Contact your administrator."
            }
          />
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError message={error} />
          <Field label="Email">
            <Input value={state.email} readOnly disabled />
          </Field>
          <Field label="Your name" hint="How colleagues will see you." error={errors.name}>
            <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            errors={errors}
          />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Activate my account
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
