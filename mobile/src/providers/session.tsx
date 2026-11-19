import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import type { Enums, Tables } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export type Ready = {
  status: "ready";
  session: Session;
  userId: string;
  email: string;
  profile: Tables<"profiles">;
  role: Enums<"app_role">;
  settings: Tables<"organization_settings"> | null;
};

type State =
  | { status: "loading" }
  | { status: "signed-out"; reason?: string }
  | { status: "inactive"; reason: string }
  | Ready;

type Ctx = {
  state: State;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  setProfile: (p: Tables<"profiles">) => void;
};

const SessionContext = createContext<Ctx | null>(null);

const INACTIVE: Record<string, string> = {
  invited: "Your account hasn't been activated yet. Open the invitation email on this phone or a computer to set your password, then sign in.",
  suspended: "Your account is suspended. Contact your administrator.",
  deactivated: "Your account has been deactivated. Contact your administrator.",
};

/** Supabase sign-in plus the employee's profile, role and organization settings (same rules as the website). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (session: Session | null, reason?: string) => {
    if (!session) {
      setState({ status: "signed-out", reason });
      return;
    }
    const uid = session.user.id;
    const [profile, role, settings] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
      supabase.from("organization_settings").select("*").eq("id", true).maybeSingle(),
    ]);
    if (profile.error) {
      setState({ status: "inactive", reason: "Couldn't load your profile. Check your connection and reopen the app." });
      return;
    }
    if (!profile.data || profile.data.employment_status !== "active") {
      setState({ status: "inactive", reason: INACTIVE[profile.data?.employment_status ?? "deactivated"] ?? INACTIVE.deactivated! });
      return;
    }
    setState({
      status: "ready",
      session,
      userId: uid,
      email: session.user.email ?? "",
      profile: profile.data,
      role: role.data?.role ?? "employee",
      settings: settings.data ?? null,
    });
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setState({ status: "signed-out" });
      else if (event === "SIGNED_IN") void load(session);
      else if (event === "TOKEN_REFRESHED" && session) {
        setState((s) => (s.status === "ready" ? { ...s, session } : s));
      }
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  // Suspension/deactivation takes effect immediately, as on the website.
  const userId = state.status === "ready" ? state.userId : null;
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`self:${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, (payload) => {
        const next = payload.new as Tables<"profiles">;
        if (next.employment_status !== "active") {
          setState({ status: "inactive", reason: INACTIVE[next.employment_status] ?? INACTIVE.deactivated! });
          return;
        }
        setState((s) => (s.status === "ready" ? { ...s, profile: { ...s.profile, ...next } } : s));
      })
      .subscribe();
    // Coarse "last seen" for the directory while the app is open.
    const touch = () => void supabase.rpc("touch_last_seen");
    touch();
    const id = setInterval(() => AppState.currentState === "active" && touch(), 4 * 60_000);
    return () => {
      clearInterval(id);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return /Invalid login credentials/i.test(error.message) ? "Email or password is incorrect." : error.message;
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const setProfile = useCallback((p: Tables<"profiles">) => {
    setState((s) => (s.status === "ready" ? { ...s, profile: p } : s));
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut, setProfile }), [state, signIn, signOut, setProfile]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionState() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionState must be used inside SessionProvider");
  return ctx;
}

/** For screens inside the signed-in area. */
export function useSession() {
  const { state, signOut, setProfile } = useSessionState();
  if (state.status !== "ready") throw new Error("useSession used outside the signed-in area");
  const isAdmin = state.role === "owner" || state.role === "admin";
  return { ...state, isAdmin, signOut, setProfile };
}
