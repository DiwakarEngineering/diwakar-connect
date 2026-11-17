"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { usePeople } from "@/components/providers/people-provider";
import { playChime, primeAudioOnInteraction } from "@/lib/sounds";

type ConvInfo = { title: string; muted: boolean; kind: Tables<"conversations">["kind"]; href: string };

type ActivityContextValue = {
  unreadNotifications: number;
  unreadChats: number;
  unreadChannels: number;
  refresh: () => void;
  /** Bumps whenever a new message arrives anywhere the user can see. */
  messageTick: number;
  /** Bumps after every refresh (e.g. a chat was pinned, muted or favourited elsewhere). */
  version: number;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export const BROWSER_NOTIFICATIONS_KEY = "dc:browser-notifications";

function browserNotificationsEnabled() {
  try {
    return (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      window.localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === "on"
    );
  } catch {
    return false;
  }
}

/**
 * Live unread counts for navigation badges, plus in-app alerts for new
 * notifications (calls get a "Join" action).
 */
export function ActivityProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();
  const { session } = useSession();
  const { people, ensure } = usePeople();
  const convInfo = useRef(new Map<string, ConvInfo>());
  // Read the latest values inside long-lived realtime callbacks.
  const live = useRef({ pathname, dnd: false, people });
  live.current = { pathname, dnd: session.profile.availability === "do_not_disturb", people };

  useEffect(() => primeAudioOnInteraction(), []);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [unreadChannels, setUnreadChannels] = useState(0);
  const [messageTick, setMessageTick] = useState(0);
  const [version, setVersion] = useState(0);
  const timer = useRef<number | null>(null);
  const deliveredTimer = useRef<number | null>(null);

  // "Delivered" receipts: tell the server this device has received new messages
  // (at most every 3 seconds).
  const markDelivered = useCallback(() => {
    if (deliveredTimer.current !== null) return;
    deliveredTimer.current = window.setTimeout(() => {
      deliveredTimer.current = null;
      void supabase.rpc("mark_conversations_delivered");
    }, 3000);
  }, [supabase]);

  const load = useCallback(async () => {
    const [notifications, chats, channels] = await Promise.all([
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null),
      supabase.rpc("list_my_conversations", { p_limit: 300 }),
      supabase.rpc("list_my_channels"),
    ]);
    if (notifications.count !== null) setUnreadNotifications(notifications.count);
    if (chats.data) {
      // Channels are counted separately (unreadChannels).
      setUnreadChats(chats.data.filter((c) => c.unread_count > 0 && !c.is_muted && c.kind !== "channel").length);
      convInfo.current = new Map(
        chats.data.map((c) => [
          c.conversation_id,
          {
            title: c.title,
            muted: c.is_muted,
            kind: c.kind,
            href: c.kind === "channel" && c.team_id && c.channel_id ? `/teams/${c.team_id}/${c.channel_id}` : `/chat/${c.conversation_id}`,
          },
        ]),
      );
    }
    if (channels.data) setUnreadChannels(channels.data.filter((c) => c.unread_count > 0).length);
    setVersion((v) => v + 1);
  }, [supabase, userId]);

  const refresh = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void load();
    }, 400);
  }, [load]);

  useEffect(() => {
    void load();
    void supabase.rpc("mark_conversations_delivered");
  }, [load, supabase]);

  /** Sound + desktop alert for a new direct/group message (not muted, not the chat on screen, not in DND). */
  const alertForMessage = useCallback(
    (m: Tables<"messages">) => {
      if (m.kind !== "user" || live.current.dnd) return;
      const info = convInfo.current.get(m.conversation_id);
      if (!info || info.muted || info.kind === "channel") return;
      const viewing = document.visibilityState === "visible" && live.current.pathname === info.href;
      if (viewing) return;
      // Mentions get their own (notification) alert.
      if (m.mentions?.includes(userId)) return;
      playChime("message");
      if (document.visibilityState === "hidden" && browserNotificationsEnabled()) {
        if (m.sender_id) ensure([m.sender_id]);
        const sender = m.sender_id ? live.current.people.get(m.sender_id)?.display_name : undefined;
        const title = info.kind === "direct" ? (sender ?? info.title) : `${sender ?? "New message"} in ${info.title}`;
        const body = m.body ? m.body.slice(0, 140) : m.sticker ? "Sent a sticker" : "Sent an attachment";
        try {
          const note = new Notification(title, { body, tag: `msg-${m.conversation_id}` });
          note.onclick = () => {
            window.focus();
            router.push(info.href);
            note.close();
          };
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
    },
    [ensure, router, userId],
  );

  useEffect(() => {
    const channel = supabase
      .channel(`activity:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Tables<"notifications">;
          refresh();
          // Do not disturb: badges still update, but no pop-ups, sounds or desktop alerts.
          if (live.current.dnd) return;
          if (n.kind !== "call") playChime(n.kind === "mention" ? "mention" : "message");
          const href = n.kind === "call" && n.conversation_id ? `/call/${n.conversation_id}` : null;
          push({
            tone: "info",
            title: n.title,
            description: n.body ?? undefined,
            durationMs: n.kind === "call" ? 20_000 : undefined,
            action: href ? { label: "Join call", onClick: () => router.push(href) } : undefined,
          });
          if (document.visibilityState === "hidden" && browserNotificationsEnabled()) {
            try {
              new Notification(n.title, { body: n.body ?? undefined, tag: n.id });
            } catch {
              // Some browsers only allow notifications from a service worker.
            }
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        setMessageTick((t) => t + 1);
        const m = payload.new as Tables<"messages">;
        if (m.sender_id !== userId) {
          refresh();
          markDelivered();
          alertForMessage(m);
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [alertForMessage, markDelivered, push, refresh, router, supabase, userId]);

  const value = useMemo(
    () => ({ unreadNotifications, unreadChats, unreadChannels, refresh, messageTick, version }),
    [messageTick, refresh, unreadChannels, unreadChats, unreadNotifications, version],
  );
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity must be used inside ActivityProvider");
  return ctx;
}
