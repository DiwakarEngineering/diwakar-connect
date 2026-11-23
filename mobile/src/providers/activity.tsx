import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { router, usePathname } from "expo-router";
import * as Haptics from "expo-haptics";
import type { Tables } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { playChime, startRingtone, stopRingtone } from "@/lib/sounds";

export type IncomingCall = {
  notificationId: string;
  callId: string | null;
  conversationId: string;
  actorId: string | null;
  title: string;
  media: "audio" | "video";
};

type Ctx = {
  unreadChats: number;
  unreadNotifications: number;
  /** Bumps on every new message anywhere I can see (lists refresh on it). */
  messageTick: number;
  refresh: () => void;
  incoming: IncomingCall | null;
  /** Answer the ringing call; pass "audio" to answer a video call with audio only. */
  answer: (media?: "audio" | "video") => void;
  decline: () => void;
};
const ActivityContext = createContext<Ctx | null>(null);
const RING_FOR_MS = 35_000;

/**
 * Unread badges, new-message chimes and incoming calls while the app is open.
 * Incoming calls come from the same "call" notifications the website uses.
 */
export function ActivityProvider({ userId, dnd, children }: { userId: string; dnd: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const [unreadChats, setUnreadChats] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [messageTick, setMessageTick] = useState(0);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const muted = useRef(new Set<string>());
  const live = useRef({ pathname, dnd });
  useEffect(() => {
    live.current = { pathname, dnd };
  }, [pathname, dnd]);

  const load = useCallback(async () => {
    const [chats, notes] = await Promise.all([
      supabase.rpc("list_my_conversations", { p_limit: 300 }),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null),
    ]);
    if (chats.data) {
      muted.current = new Set(chats.data.filter((c) => c.is_muted).map((c) => c.conversation_id));
      setUnreadChats(chats.data.filter((c) => c.unread_count > 0 && !c.is_muted && c.kind !== "channel").length);
    }
    if (notes.count !== null) setUnreadNotifications(notes.count);
  }, [userId]);

  const refresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void load();
    }, 400);
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set when the request resolves
    void load();
    void supabase.rpc("mark_conversations_delivered").then(() => undefined, () => undefined);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        void load();
        void supabase.rpc("mark_conversations_delivered").then(() => undefined, () => undefined);
      }
    });
    return () => sub.remove();
  }, [load]);

  const stopRinging = useCallback(() => {
    stopRingtone();
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`m-activity:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        const n = payload.new as Tables<"notifications">;
        refresh();
        if (n.kind === "call" && n.conversation_id) {
          // Do not disturb: the call still shows in Calls and the chat, but doesn't ring.
          if (live.current.dnd) return;
          setIncoming({
            notificationId: n.id,
            callId: n.call_id,
            conversationId: n.conversation_id,
            actorId: n.actor_id,
            title: n.title,
            media: /audio call/.test(n.title) ? "audio" : "video",
          });
          startRingtone();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
          if (ringTimer.current) clearTimeout(ringTimer.current);
          ringTimer.current = setTimeout(() => {
            stopRingtone();
            setIncoming(null);
            // Record a missed call (needs the call-ringing migration; harmless without it).
            if (n.call_id) void supabase.rpc("respond_to_call", { p_call_id: n.call_id, p_response: "missed" }).then(() => undefined, () => undefined);
          }, RING_FOR_MS);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as Tables<"messages">;
        setMessageTick((t) => t + 1);
        if (m.sender_id === userId) return;
        refresh();
        void supabase.rpc("mark_conversations_delivered").then(() => undefined, () => undefined);
        const viewing = live.current.pathname === `/chat/${m.conversation_id}`;
        if (m.kind === "user" && !viewing && !live.current.dnd && !muted.current.has(m.conversation_id)) playChime();
      })
      // The caller hung up before I answered: stop ringing.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls" }, (payload) => {
        const c = payload.new as Tables<"calls">;
        if (c.status === "ended") {
          setIncoming((cur) => {
            if (cur && cur.callId === c.id) {
              stopRingtone();
              return null;
            }
            return cur;
          });
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const answer = useCallback(
    (media?: "audio" | "video") => {
      if (!incoming) return;
      stopRinging();
      const call = incoming;
      setIncoming(null);
      void supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", call.notificationId);
      router.push({ pathname: "/call/[conversationId]", params: { conversationId: call.conversationId, media: media ?? call.media } });
    },
    [incoming, stopRinging],
  );

  const decline = useCallback(() => {
    if (!incoming) return;
    stopRinging();
    void supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", incoming.notificationId);
    // Tell the caller (their screen shows "Declined").
    if (incoming.callId) void supabase.rpc("respond_to_call", { p_call_id: incoming.callId, p_response: "declined" }).then(() => undefined, () => undefined);
    setIncoming(null);
  }, [incoming, stopRinging]);

  const value = useMemo(
    () => ({ unreadChats, unreadNotifications, messageTick, refresh, incoming, answer, decline }),
    [unreadChats, unreadNotifications, messageTick, refresh, incoming, answer, decline],
  );
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity must be used inside ActivityProvider");
  return ctx;
}
