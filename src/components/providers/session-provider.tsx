"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAdminRole, type SessionInfo } from "@/lib/session";

type SessionContextValue = {
  session: SessionInfo;
  isAdmin: boolean;
  isOwner: boolean;
  setProfile: (profile: Tables<"profiles">) => void;
  refreshSettings: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const LAST_SEEN_INTERVAL_MS = 4 * 60_000;

export function SessionProvider({ initial, children }: { initial: SessionInfo; children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const signingOut = useRef(false);
  const supabase = getSupabaseBrowserClient();

  const setProfile = useCallback((profile: Tables<"profiles">) => setSession((s) => ({ ...s, profile })), []);

  const refreshSettings = useCallback(async () => {
    const { data } = await supabase.from("organization_settings").select("*").eq("id", true).maybeSingle();
    if (data) setSession((s) => ({ ...s, settings: data }));
  }, [supabase]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    await supabase.auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }, [router, supabase]);

  // Expired or revoked sessions: send the person back to sign in with a reason.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !signingOut.current) {
        router.replace("/sign-in?reason=expired");
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router, supabase]);

  // If an admin suspends or deactivates this account, leave immediately.
  useEffect(() => {
    const channel = supabase
      .channel(`self:${session.userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.userId}` },
        (payload) => {
          const next = payload.new as Tables<"profiles">;
          if (next.employment_status !== "active") {
            router.replace("/account-disabled");
            return;
          }
          setSession((s) => ({ ...s, profile: { ...s.profile, ...next } }));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, session.userId, supabase]);

  // Coarse "last seen" for the directory.
  useEffect(() => {
    const touch = () => {
      if (document.visibilityState === "visible") void supabase.rpc("touch_last_seen");
    };
    touch();
    const id = window.setInterval(touch, LAST_SEEN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [supabase]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isAdmin: isAdminRole(session.role),
      isOwner: session.role === "owner",
      setProfile,
      refreshSettings,
      signOut,
    }),
    [refreshSettings, session, setProfile, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
