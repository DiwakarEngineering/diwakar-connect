"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { BellOff, CheckCheck, Settings } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { NotificationItem, notificationHref } from "@/components/notifications/notification-item";
import { useChannelHrefs } from "@/components/notifications/use-channel-hrefs";

const PAGE = 30;

export default function NotificationsPage() {
  const { session } = useSession();
  const { refresh, unreadNotifications } = useActivity();
  const { push } = useToast();
  const channelHrefs = useChannelHrefs();
  const [items, setItems] = useState<Tables<"notifications">[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const supabase = getSupabaseBrowserClient();

  const load = useCallback(
    async (before?: string) => {
      let query = supabase
        .from("notifications")
        .select("*")
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (unreadOnly) query = query.is("read_at", null);
      if (before) query = query.lt("created_at", before);
      const { data, error: loadError } = await query;
      if (loadError) {
        setError(friendlyError(loadError, "Couldn't load notifications."));
        return;
      }
      setError(null);
      setHasMore((data ?? []).length === PAGE);
      setItems((prev) => (before && prev ? [...prev, ...(data ?? [])] : (data ?? [])));
    },
    [session.userId, supabase, unreadOnly],
  );

  useEffect(() => {
    setItems(null);
    void load();
  }, [load, unreadNotifications]);

  async function markAll() {
    const { error: markError } = await supabase.rpc("mark_all_notifications_read");
    if (markError) {
      push({ tone: "error", title: "Couldn't mark as read", description: friendlyError(markError) });
      return;
    }
    refresh();
    void load();
  }

  async function markOne(n: Tables<"notifications">) {
    if (n.read_at) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="hidden text-xl font-semibold text-ink-900 md:block">Notifications</h1>
            <p className="text-sm text-ink-500">Mentions, replies, team invitations and calls.</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/settings#notifications"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink-700 hover:bg-canvas"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              Preferences
            </Link>
            <Button size="sm" onClick={() => void markAll()} disabled={unreadNotifications === 0}>
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Mark all read
            </Button>
          </div>
        </div>

        <div role="tablist" aria-label="Filter notifications" className="mt-4 flex gap-1">
          {[
            { id: false, label: "All" },
            { id: true, label: `Unread${unreadNotifications ? ` (${unreadNotifications})` : ""}` },
          ].map((f) => (
            <button
              key={String(f.id)}
              type="button"
              role="tab"
              aria-selected={unreadOnly === f.id}
              onClick={() => setUnreadOnly(f.id)}
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium",
                unreadOnly === f.id ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : items === null ? (
            <SkeletonRows rows={6} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<BellOff className="h-5 w-5" aria-hidden="true" />}
              title={unreadOnly ? "Nothing unread" : "No notifications yet"}
              description="When someone mentions you, replies to you, adds you to a team or calls you, it shows up here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationItem notification={n} href={notificationHref(n, channelHrefs)} onOpen={(x) => void markOne(x)} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {hasMore && items ? (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              loading={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                await load(items[items.length - 1]?.created_at);
                setLoadingMore(false);
              }}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
