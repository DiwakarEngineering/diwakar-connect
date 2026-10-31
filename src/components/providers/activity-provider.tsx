"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

type ActivityContextValue = {
  unreadNotifications: number;
  unreadChats: number;
  unreadChannels: number;
  refresh: () => void;
  /** Bumps whenever a new message arrives anywhere the user can see. */
  messageTick: number;
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
  const { push } = useToast();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [unreadChannels, setUnreadChannels] = useState(0);
  const [messageTick, setMessageTick] = useState(0);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [notifications, chats, channels] = await Promise.all([
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null),
      supabase.rpc("list_my_conversations", { p_unread_only: true, p_limit: 200 }),
      supabase.rpc("list_my_channels"),
    ]);
    if (notifications.count !== null) setUnreadNotifications(notifications.count);
    if (chats.data) setUnreadChats(chats.data.filter((c) => !c.is_muted).length);
    if (channels.data) setUnreadChannels(channels.data.filter((c) => c.unread_count > 0).length);
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
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`activity:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Tables<"notifications">;
          refresh();
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
        if (m.sender_id !== userId) refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [push, refresh, router, supabase, userId]);

  const value = useMemo(
    () => ({ unreadNotifications, unreadChats, unreadChannels, refresh, messageTick }),
    [messageTick, refresh, unreadChannels, unreadChats, unreadNotifications],
  );
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error("useActivity must be used inside ActivityProvider");
  return ctx;
}
