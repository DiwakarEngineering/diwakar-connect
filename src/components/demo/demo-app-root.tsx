"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SessionInfo } from "@/lib/session";
import { AppProviders } from "@/components/providers/app-providers";
import { ErrorState, LoadingState } from "@/components/ui/states";

/**
 * DEMO MODE: the client-side equivalent of the server gate in (app)/layout.tsx,
 * because the demo database lives in the browser.
 */
export function DemoAppRoot({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace(pathname === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(pathname)}`);
          return;
        }
        const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
        if (!profile || profile.employment_status !== "active") {
          router.replace("/account-disabled");
          return;
        }
        const [{ data: roleRow }, { data: settings }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
          supabase.from("organization_settings").select("*").eq("id", true).single(),
        ]);
        if (!settings) throw new Error("Demo database isn't ready.");
        if (alive) setSession({ userId: user.id, email: user.email ?? "", profile, role: roleRow?.role ?? "employee", settings });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "The demo database couldn't start.");
      }
    })();
    return () => {
      alive = false;
    };
    // Only on first load; navigation inside the app keeps the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} className="min-h-dvh" />;
  if (!session) return <LoadingState label="Starting the local database" className="min-h-dvh" />;
  return <AppProviders session={session}>{children}</AppProviders>;
}
