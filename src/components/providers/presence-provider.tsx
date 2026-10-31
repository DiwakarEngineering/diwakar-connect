"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PresenceContextValue = { online: Set<string>; connected: boolean };
const PresenceContext = createContext<PresenceContextValue>({ online: new Set(), connected: false });

/**
 * Who has the app open right now, via a private Realtime presence channel
 * (authorized by RLS on realtime.messages: active employees only).
 */
export function PresenceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const channel = supabase.channel("org:presence", {
      config: { private: true, presence: { key: userId } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe(async (status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  const value = useMemo(() => ({ online, connected }), [online, connected]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}
