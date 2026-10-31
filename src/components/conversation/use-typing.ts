"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const SEND_EVERY_MS = 2500;
const SHOW_FOR_MS = 4500;

/**
 * Typing indicators over a private Realtime broadcast topic. Only
 * conversation members can join it (RLS on realtime.messages).
 */
export function useTyping(conversationId: string, userId: string) {
  const [typing, setTyping] = useState<Record<string, number>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`conversation:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const from = (payload as { userId?: string }).userId;
        if (!from || from === userId) return;
        setTyping((t) => ({ ...t, [from]: Date.now() }));
      })
      .on("broadcast", { event: "stopped" }, ({ payload }) => {
        const from = (payload as { userId?: string }).userId;
        if (!from) return;
        setTyping((t) => {
          const next = { ...t };
          delete next[from];
          return next;
        });
      })
      .subscribe();
    channelRef.current = channel;

    const sweep = window.setInterval(() => {
      setTyping((t) => {
        const now = Date.now();
        const entries = Object.entries(t).filter(([, at]) => now - at < SHOW_FOR_MS);
        return entries.length === Object.keys(t).length ? t : Object.fromEntries(entries);
      });
    }, 1000);

    return () => {
      window.clearInterval(sweep);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, userId]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSent.current < SEND_EVERY_MS) return;
    lastSent.current = now;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId } });
  }, [userId]);

  const notifyStopped = useCallback(() => {
    lastSent.current = 0;
    void channelRef.current?.send({ type: "broadcast", event: "stopped", payload: { userId } });
  }, [userId]);

  return { typingUserIds: Object.keys(typing), notifyTyping, notifyStopped };
}
