"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** What someone is doing right now, shared through presence (cleared automatically when they disconnect). */
export type PresenceActivity = "call" | "meeting";

type PresenceContextValue = {
  online: Set<string>;
  connected: boolean;
  activities: Map<string, PresenceActivity>;
  /** Set or clear this device's activity (e.g. while connected to a call). */
  setMyActivity: (activity: PresenceActivity | null) => void;
};
const PresenceContext = createContext<PresenceContextValue>({
  online: new Set(),
  connected: false,
  activities: new Map(),
  setMyActivity: () => {},
});

type Meta = { online_at?: string; activity?: PresenceActivity | null };

/**
 * Who has the app open right now, and who is in a call or meeting, via a
 * private Realtime presence channel (authorized by RLS on realtime.messages:
 * active employees only). Presence disappears when the tab closes or the
 * connection drops, so "In a call" can never get stuck.
 */
export function PresenceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [activities, setActivities] = useState<Map<string, PresenceActivity>>(new Map());
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const activityRef = useRef<PresenceActivity | null>(null);
  const onlineAt = useRef(new Date().toISOString());

  useEffect(() => {
    const channel = supabase.channel("org:presence", {
      config: { private: true, presence: { key: userId } },
    });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Meta>();
        setOnline(new Set(Object.keys(state)));
        const next = new Map<string, PresenceActivity>();
        for (const [uid, metas] of Object.entries(state)) {
          // Any of the person's devices being in a meeting/call counts.
          const all = metas.map((m) => m.activity).filter(Boolean) as PresenceActivity[];
          if (all.includes("meeting")) next.set(uid, "meeting");
          else if (all.includes("call")) next.set(uid, "call");
        }
        setActivities(next);
      })
      .subscribe(async (status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: onlineAt.current, activity: activityRef.current });
        }
      });
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  const setMyActivity = useCallback((activity: PresenceActivity | null) => {
    activityRef.current = activity;
    void channelRef.current?.track({ online_at: onlineAt.current, activity });
  }, []);

  const value = useMemo(() => ({ online, connected, activities, setMyActivity }), [online, connected, activities, setMyActivity]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}
