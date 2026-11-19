import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Enums } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { AVAILABILITY, colors } from "@/theme";

export type Activity = "call" | "meeting";
type Meta = { online_at?: string; activity?: Activity | null };
type Ctx = { online: Set<string>; activities: Map<string, Activity>; setMyActivity: (a: Activity | null) => void };
const PresenceContext = createContext<Ctx>({ online: new Set(), activities: new Map(), setMyActivity: () => {} });

/**
 * Same private presence channel as the website ("org:presence"), so phone and
 * browser users see each other online, in a call, etc. The app leaves the
 * channel in the background and rejoins when opened.
 */
export function PresenceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [activities, setActivities] = useState<Map<string, Activity>>(new Map());
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const activityRef = useRef<Activity | null>(null);
  const [myActivity, setMyActivityState] = useState<Activity | null>(null);
  const onlineAt = useRef(new Date().toISOString());

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setForeground(s === "active"));
    return () => sub.remove();
  }, []);

  // Stay present during a call even when the screen is off / app is backgrounded.
  const keepAlive = foreground || myActivity !== null;

  useEffect(() => {
    if (!keepAlive) return;
    const channel = supabase.channel("org:presence", { config: { private: true, presence: { key: userId } } });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Meta>();
        setOnline(new Set(Object.keys(state)));
        const next = new Map<string, Activity>();
        for (const [uid, metas] of Object.entries(state)) {
          const all = metas.map((m) => m.activity).filter(Boolean) as Activity[];
          if (all.includes("meeting")) next.set(uid, "meeting");
          else if (all.includes("call")) next.set(uid, "call");
        }
        setActivities(next);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ online_at: onlineAt.current, activity: activityRef.current });
      });
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [keepAlive, userId]);

  const setMyActivity = useCallback((a: Activity | null) => {
    activityRef.current = a;
    setMyActivityState(a);
    void channelRef.current?.track({ online_at: onlineAt.current, activity: a });
  }, []);

  const value = useMemo(() => ({ online, activities, setMyActivity }), [online, activities, setMyActivity]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}

/** Label and dot colour for a person, combining their chosen availability with whether they're connected. */
export function usePresenceState(userId: string | undefined, availability: Enums<"availability"> | undefined) {
  const { online, activities } = usePresence();
  if (!userId || !availability || availability === "offline" || !online.has(userId)) {
    return { label: "Offline", color: colors.ink300, online: false };
  }
  const activity = activities.get(userId);
  if (activity && availability !== "do_not_disturb") {
    return { label: activity === "meeting" ? "In a meeting" : "In a call", color: colors.danger600, online: true };
  }
  return { label: AVAILABILITY[availability].label, color: AVAILABILITY[availability].color, online: true };
}
