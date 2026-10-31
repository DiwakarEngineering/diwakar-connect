"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthFrame } from "@/components/auth/auth-frame";
import { FormError } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/validation";

/**
 * Landing page for links in Supabase auth emails (invite, password recovery).
 * Handles both the PKCE `?code=` form and the token-in-fragment form that
 * Supabase uses for admin-generated invitations.
 */
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const next = safeNextPath(params.get("next"));
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const linkError = params.get("error_description") ?? hash.get("error_description");

    void (async () => {
      if (linkError) {
        setError(linkError.includes("expired") ? "This link has expired. Ask for a new one." : linkError);
        return;
      }

      // The client may already have processed the URL during initialization.
      const existing = await supabase.auth.getSession();
      if (!existing.data.session) {
        const code = params.get("code");
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        let failed = false;
        if (code) {
          failed = !!(await supabase.auth.exchangeCodeForSession(code)).error;
        } else if (accessToken && refreshToken) {
          failed = !!(await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })).error;
        } else {
          failed = true;
        }
        if (failed) {
          setError("This link is invalid or has already been used. Ask for a new one.");
          return;
        }
      }
      // Remove tokens from the address bar and history.
      window.history.replaceState(null, "", "/auth/callback");
      router.replace(next);
      router.refresh();
    })();
  }, [params, router]);

  if (error) {
    return (
      <div className="space-y-4">
        <FormError message={error} />
        <Link href="/sign-in" className="text-sm font-medium text-brand-700 hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }
  return <LoadingState label="Signing you in" />;
}

export default function AuthCallbackPage() {
  return (
    <AuthFrame title="One moment">
      <Suspense fallback={<LoadingState label="Signing you in" />}>
        <Callback />
      </Suspense>
    </AuthFrame>
  );
}
