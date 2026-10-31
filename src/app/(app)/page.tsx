"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, Contact, Hash, MessageSquare, MessageSquarePlus, Phone, Users, Video } from "lucide-react";
import type { RpcRow, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { duration, listTime } from "@/lib/format";
import { AVAILABILITY } from "@/lib/constants";
import { Avatar } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useSession } from "@/components/providers/session-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { NewChatDialog } from "@/components/chat/new-chat-dialog";
import { NotificationItem, notificationHref } from "@/components/notifications/notification-item";
import { callsAvailable, useCallConfig } from "@/components/calls/use-call-config";
import { useConversationTitles } from "@/components/calls/use-conversation-titles";

type HomeData = {
  mentions: Tables<"notifications">[];
  chats: RpcRow<"list_my_conversations">[];
  channels: RpcRow<"list_my_channels">[];
  calls: Tables<"calls">[];
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Card({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card" aria-label={title}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <span className="text-brand-600">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

export default function HomePage() {
  const { session } = useSession();
  const { messageTick, unreadNotifications } = useActivity();
  const callConfig = useCallConfig();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const supabase = getSupabaseBrowserClient();

  const load = useCallback(async () => {
    const [mentions, chats, channels, calls] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", session.userId)
        .in("kind", ["mention", "reply"])
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.rpc("list_my_conversations", { p_unread_only: true, p_limit: 6 }),
      supabase.rpc("list_my_channels"),
      supabase.from("calls").select("*").eq("status", "active").order("started_at", { ascending: false }).limit(5),
    ]);
    const firstError = mentions.error ?? chats.error ?? channels.error ?? calls.error;
    if (firstError) {
      setError(friendlyError(firstError, "Couldn't load your activity."));
      return;
    }
    setError(null);
    setData({ mentions: mentions.data ?? [], chats: chats.data ?? [], channels: channels.data ?? [], calls: calls.data ?? [] });
  }, [session.userId, supabase]);

  useEffect(() => {
    void load();
  }, [load, messageTick, unreadNotifications]);

  const people = usePeopleById((data?.chats ?? []).map((c) => c.other_user_id));
  const channelHrefs = new Map((data?.channels ?? []).map((c) => [c.conversation_id, `/teams/${c.team_id}/${c.channel_id}`]));
  const titles = useConversationTitles((data?.calls.length ?? 0) > 0);
  const unreadChannels = (data?.channels ?? []).filter((c) => c.unread_count > 0);
  const availability = AVAILABILITY[session.profile.availability];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar
              name={session.profile.display_name}
              path={session.profile.avatar_path}
              userId={session.userId}
              availability={session.profile.availability}
              showPresence
              size="lg"
            />
            <div>
              <h1 className="text-xl font-semibold text-ink-900 md:text-2xl">
                {greeting()}, {session.profile.display_name.split(" ")[0]}
              </h1>
              <p className="text-sm text-ink-500">
                You&apos;re {availability.label.toLowerCase()}
                {session.profile.status_message ? ` · "${session.profile.status_message}"` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setNewChatOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-card hover:bg-brand-700"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              New chat
            </button>
            <Link href="/calls" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink-800 hover:bg-canvas">
              <Phone className="h-4 w-4" aria-hidden="true" />
              Calls
            </Link>
            <Link href="/people" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink-800 hover:bg-canvas">
              <Contact className="h-4 w-4" aria-hidden="true" />
              Directory
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-line bg-white">
            <ErrorState message={error} onRetry={() => void load()} />
          </div>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card
              title="Mentions & replies"
              icon={<AtSign className="h-4 w-4" aria-hidden="true" />}
              action={
                <Link href="/notifications" className="text-xs font-medium text-brand-700 hover:underline">
                  All notifications
                </Link>
              }
            >
              {data === null ? (
                <SkeletonRows rows={3} />
              ) : data.mentions.length === 0 ? (
                <EmptyState title="No new mentions" description="When someone @mentions you or replies to your message, it appears here." />
              ) : (
                <ul className="divide-y divide-line">
                  {data.mentions.map((n) => (
                    <li key={n.id}>
                      <NotificationItem notification={n} href={notificationHref(n, channelHrefs)} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Unread chats"
              icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
              action={
                <Link href="/chat" className="text-xs font-medium text-brand-700 hover:underline">
                  Open chat
                </Link>
              }
            >
              {data === null ? (
                <SkeletonRows rows={3} />
              ) : data.chats.length === 0 ? (
                <EmptyState title="You're all caught up" description="New direct and group messages will show up here." />
              ) : (
                <ul className="divide-y divide-line">
                  {data.chats.map((c) => {
                    const other = c.other_user_id ? people.get(c.other_user_id) : undefined;
                    return (
                      <li key={c.conversation_id}>
                        <Link href={`/chat/${c.conversation_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                          {c.kind === "direct" ? (
                            <Avatar name={c.title} path={other?.avatar_path} userId={c.other_user_id ?? undefined} availability={other?.availability} showPresence size="sm" />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E7EEFF] text-[#2B4C9B]">
                              <Users className="h-4 w-4" aria-hidden="true" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink-900">{c.title}</span>
                            <span className="block truncate text-xs text-ink-500">{c.last_message_preview}</span>
                          </span>
                          <span className="flex flex-col items-end gap-1">
                            <span className="text-[11px] text-ink-400">{listTime(c.last_message_at)}</span>
                            <CountBadge count={c.unread_count} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card title="Live calls" icon={<Video className="h-4 w-4" aria-hidden="true" />}>
              {!callsAvailable(callConfig) && callConfig.status === "ready" ? (
                <EmptyState
                  title="Calling isn't available"
                  description={
                    callConfig.providerConfigured
                      ? "Calls are turned off for your organization."
                      : "Calling hasn't been set up on this server yet. Chat and teams work as normal."
                  }
                />
              ) : data === null ? (
                <SkeletonRows rows={2} />
              ) : data.calls.length === 0 ? (
                <EmptyState title="No calls in progress" description="Start an audio or video call from any chat or channel. Scheduled meetings aren't supported yet." />
              ) : (
                <ul className="divide-y divide-line">
                  {data.calls.map((call) => (
                    <li key={call.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-50 text-success-700">
                        {call.media === "audio" ? <Phone className="h-4 w-4" aria-hidden="true" /> : <Video className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-900">
                          {titles.get(call.conversation_id)?.title ?? "Call"}
                        </span>
                        <span className="block text-xs text-ink-500">Started {duration(call.started_at, null)} ago</span>
                      </span>
                      <Link
                        href={`/call/${call.conversation_id}`}
                        className="inline-flex h-8 items-center rounded-lg bg-success-600 px-3 text-xs font-semibold text-white hover:bg-success-700"
                      >
                        Join
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Team channels with new posts"
              icon={<Hash className="h-4 w-4" aria-hidden="true" />}
              action={
                <Link href="/teams" className="text-xs font-medium text-brand-700 hover:underline">
                  All teams
                </Link>
              }
            >
              {data === null ? (
                <SkeletonRows rows={3} />
              ) : unreadChannels.length === 0 ? (
                <EmptyState
                  title={data.channels.length === 0 ? "You're not in any teams yet" : "No new channel posts"}
                  description={data.channels.length === 0 ? "Browse public teams to join one." : undefined}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {unreadChannels.slice(0, 6).map((c) => (
                    <li key={c.channel_id}>
                      <Link href={`/teams/${c.team_id}/${c.channel_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                          <Hash className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink-900">{c.channel_name}</span>
                          <span className="block truncate text-xs text-ink-500">{c.team_name}</span>
                        </span>
                        <CountBadge count={c.unread_count} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
      <NewChatDialog open={newChatOpen} onClose={() => setNewChatOpen(false)} />
    </div>
  );
}
