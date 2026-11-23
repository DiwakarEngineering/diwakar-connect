"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { AtSign, Bell, BellOff, CheckCheck, EyeOff, Hash, Link2, MailWarning, MessageSquarePlus, MoreHorizontal, Pin, PinOff, Search, SquareArrowOutUpRight, Star, StarOff, Trash2, Users } from "lucide-react";
import type { RpcRow, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { listTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CountBadge } from "@/components/ui/badge";
import { Menu } from "@/components/ui/menu";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById, type Person } from "@/components/providers/people-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { NotificationItem, notificationHref } from "@/components/notifications/notification-item";
import { useChannelHrefs } from "@/components/notifications/use-channel-hrefs";

type Row = RpcRow<"list_my_conversations">;
type Filter = "all" | "unread" | "chats" | "channels" | "mentions";

const FILTERS: { id: Exclude<Filter, "mentions">; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "chats", label: "Chats" },
  { id: "channels", label: "Channels" },
];

function rowHref(row: Row) {
  return row.kind === "channel" && row.team_id && row.channel_id ? `/teams/${row.team_id}/${row.channel_id}` : `/chat/${row.conversation_id}`;
}

/**
 * Chat workspace list: direct chats, group chats and the channels of my teams,
 * with Unread / Chats / Channels filters, Favorites, Mentions, live unread
 * counts, presence and per-conversation pin, mute and favourite.
 */
export function ConversationList() {
  const pathname = usePathname();
  const router = useRouter();
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { session } = useSession();
  const { messageTick, version, refresh: refreshActivity } = useActivity();
  const { push } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mentions, setMentions] = useState<Tables<"notifications">[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const channelHrefs = useChannelHrefs();
  const supabase = getSupabaseBrowserClient();

  const load = useCallback(async () => {
    const [convs, mention] = await Promise.all([
      supabase.rpc("list_my_conversations", {
        p_unread_only: filter === "unread",
        p_search: search.trim() || null,
        p_limit: 300,
      }),
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", session.userId)
        .eq("kind", "mention")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (convs.error) {
      setError(friendlyError(convs.error, "Couldn't load chats."));
      return;
    }
    setError(null);
    setRows(convs.data ?? []);
    setMentions(mention.data ?? []);
  }, [filter, search, session.userId, supabase]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [load, search, messageTick, pathname, version]);

  const people = usePeopleById((rows ?? []).flatMap((r) => [r.other_user_id, r.last_sender_id]));

  const visible = useMemo(() => {
    const all = rows ?? [];
    if (filter === "chats") return all.filter((r) => r.kind !== "channel");
    if (filter === "channels") return all.filter((r) => r.kind === "channel");
    if (filter === "all" && !search.trim()) {
      // Keep the default view focused: channels only once they have activity or are pinned/favourite.
      return all.filter((r) => r.kind !== "channel" || r.unread_count > 0 || r.is_pinned || r.is_favorite || r.last_message_preview);
    }
    return all;
  }, [filter, rows, search]);

  const sectioned = filter === "all" && !search.trim();
  const favorites = sectioned ? visible.filter((r) => r.is_favorite) : [];
  const recent = sectioned ? visible.filter((r) => !r.is_favorite) : visible;
  const unreadMentions = (mentions ?? []).filter((m) => !m.read_at).length;

  async function setPref(row: Row, patch: { p_is_pinned?: boolean; p_is_muted?: boolean; p_is_favorite?: boolean }) {
    const { error: prefError } = await supabase.rpc("set_conversation_preferences", { p_conversation_id: row.conversation_id, ...patch });
    if (prefError) {
      push({ tone: "error", title: "Couldn't update chat", description: friendlyError(prefError) });
      return;
    }
    void load();
    refreshActivity();
  }

  async function markRead(row: Row) {
    await supabase.rpc("mark_conversation_read", { p_conversation_id: row.conversation_id });
    void load();
    refreshActivity();
  }

  // The new options need 20261123000100_chat_options.sql; say so plainly if it isn't applied yet.
  const optionError = (title: string, e: { message?: string; code?: string } | null) =>
    push({
      tone: "error",
      title,
      description: /function .* does not exist|could not find the function|PGRST202/i.test(`${e?.message ?? ""} ${e?.code ?? ""}`)
        ? "This option needs the latest database update. Ask your administrator to apply it."
        : friendlyError(e),
    });

  const after = (row: Row, leave: boolean) => {
    // Leave the conversation if it's open (an open chat is marked read straight away).
    if (leave && pathname === rowHref(row)) router.push("/chat");
    void load();
    refreshActivity();
  };

  async function markUnread(row: Row) {
    const { error: e } = await supabase.rpc("mark_conversation_unread", { p_conversation_id: row.conversation_id });
    if (e) return optionError("Couldn't mark as unread", e);
    after(row, true);
  }

  async function hide(row: Row, hidden = true) {
    const { error: e } = await supabase.rpc("hide_conversation", { p_conversation_id: row.conversation_id, p_hidden: hidden });
    if (e) return optionError(hidden ? "Couldn't hide the chat" : "Couldn't show the chat", e);
    after(row, hidden);
    if (hidden)
      push({
        tone: "success",
        title: "Chat hidden",
        description: "It comes back when there's a new message. Search finds it any time.",
        action: { label: "Undo", onClick: () => void hide(row, false) },
      });
  }

  async function deleteChat(row: Row) {
    setDeleting(true);
    const { error: e } = await supabase.rpc("delete_conversation_for_me", { p_conversation_id: row.conversation_id });
    setDeleting(false);
    setToDelete(null);
    if (e) return optionError("Couldn't delete the chat", e);
    after(row, true);
    push({ tone: "success", title: "Chat deleted for you" });
  }

  function copyLink(row: Row) {
    const url = `${window.location.origin}${rowHref(row)}`;
    navigator.clipboard
      .writeText(url)
      .then(() => push({ tone: "success", title: "Link copied", description: "Only members of this chat can open it." }))
      .catch(() => push({ tone: "error", title: "Couldn't copy the link" }));
  }

  function popOut(row: Row) {
    const w = window.open(`/popout/chat/${row.conversation_id}`, `dc-chat-${row.conversation_id}`, "popup,width=480,height=720");
    if (!w) push({ tone: "error", title: "Pop-up blocked", description: "Allow pop-ups for this site to open chats in their own window." });
  }

  async function openMention(n: Tables<"notifications">) {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      refreshActivity();
    }
  }

  const renderRows = (list: Row[]) =>
    list.map((row) => (
      <ConversationRow
        key={row.conversation_id}
        row={row}
        active={pathname === rowHref(row)}
        me={session.userId}
        people={people}
        onPref={(patch) => void setPref(row, patch)}
        onMarkRead={() => void markRead(row)}
        onMarkUnread={() => void markUnread(row)}
        onHide={() => void hide(row)}
        onDelete={() => setToDelete(row)}
        onCopyLink={() => copyLink(row)}
        onPopOut={() => popOut(row)}
      />
    ));

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="hidden text-lg font-semibold text-ink-900 md:block">Chat</h1>
        <Link
          href="/chat/new"
          aria-current={pathname === "/chat/new" ? "page" : undefined}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 md:ml-auto"
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          New chat
        </Link>
      </div>
      <div className="space-y-2 px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats and channels"
            aria-label="Search chats and channels"
            className="h-9 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm placeholder:text-ink-400 focus:bg-white"
          />
        </div>
        <div role="tablist" aria-label="Filter conversations" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.id ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-line">
        <button
          type="button"
          onClick={() => setFilter(filter === "mentions" ? "all" : "mentions")}
          aria-pressed={filter === "mentions"}
          className={clsx(
            "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
            filter === "mentions" ? "bg-brand-50" : "hover:bg-canvas",
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <AtSign className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className={clsx("flex-1 text-sm", unreadMentions ? "font-semibold text-ink-900" : "font-medium text-ink-800")}>Mentions</span>
          {unreadMentions ? <CountBadge count={unreadMentions} /> : null}
        </button>

        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : filter === "mentions" ? (
          mentions === null ? (
            <SkeletonRows rows={5} />
          ) : mentions.length === 0 ? (
            <EmptyState icon={<AtSign className="h-5 w-5" aria-hidden="true" />} title="No mentions yet" description="When someone @mentions you, it shows up here." />
          ) : (
            <ul aria-label="Mentions" className="divide-y divide-line">
              {mentions.map((n) => (
                <li key={n.id}>
                  <NotificationItem notification={n} href={notificationHref(n, channelHrefs)} onOpen={(x) => void openMention(x)} compact />
                </li>
              ))}
            </ul>
          )
        ) : rows === null ? (
          <SkeletonRows rows={8} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<MessageSquarePlus className="h-5 w-5" aria-hidden="true" />}
            title={
              search
                ? "Nothing matches"
                : filter === "unread"
                  ? "You're all caught up"
                  : filter === "channels"
                    ? "No channels yet"
                    : "No chats yet"
            }
            description={
              search || filter === "unread"
                ? undefined
                : filter === "channels"
                  ? "Join a team to see its channels here."
                  : "Start a conversation with a colleague or a group."
            }
            action={
              !search && (filter === "all" || filter === "chats") ? (
                <Link href="/chat/new" className="inline-flex h-8 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
                  Start a chat
                </Link>
              ) : undefined
            }
          />
        ) : sectioned ? (
          <>
            {favorites.length ? (
              <section aria-labelledby="dc-favs">
                <h2 id="dc-favs" className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  Favorites
                </h2>
                <ul>{renderRows(favorites)}</ul>
              </section>
            ) : null}
            <section aria-labelledby="dc-recent">
              <h2 id="dc-recent" className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Recent
              </h2>
              {recent.length ? <ul>{renderRows(recent)}</ul> : <p className="px-4 py-3 text-xs text-ink-500">Everything is in Favorites.</p>}
            </section>
          </>
        ) : (
          <ul aria-label="Conversations">{renderRows(visible)}</ul>
        )}
      </div>
      <Dialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        busy={deleting}
        size="sm"
        title="Delete this chat?"
        description="The chat and its history are removed for you only; everyone else keeps their copy. If someone sends a new message, the chat comes back starting from that message."
        footer={
          <>
            <Button onClick={() => setToDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => toDelete && void deleteChat(toDelete)}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

function ConversationRow({
  row,
  active,
  me,
  people,
  onPref,
  onMarkRead,
  onMarkUnread,
  onHide,
  onDelete,
  onCopyLink,
  onPopOut,
}: {
  row: Row;
  active: boolean;
  me: string;
  people: Map<string, Person>;
  onPref: (patch: { p_is_pinned?: boolean; p_is_muted?: boolean; p_is_favorite?: boolean }) => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onHide: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onPopOut: () => void;
}) {
  const other = row.other_user_id ? people.get(row.other_user_id) : undefined;
  const sender = row.last_sender_id
    ? row.last_sender_id === me
      ? "You"
      : people.get(row.last_sender_id)?.display_name?.split(" ")[0]
    : undefined;
  const preview =
    row.last_message_preview === null
      ? row.kind === "channel"
        ? row.team_name
          ? `${row.team_name} · no posts yet`
          : "No posts yet"
        : "No messages yet"
      : row.last_message_kind === "system"
        ? `${row.last_sender_id ? (sender ?? "Someone") + " " : ""}${row.last_message_preview}`
        : row.kind !== "direct" || row.last_sender_id === me
          ? `${sender ?? "Someone"}: ${row.last_message_preview}`
          : row.last_message_preview;
  const unread = row.unread_count > 0;

  return (
    <li className="group relative">
      <Link
        href={rowHref(row)}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "flex items-center gap-3 px-4 py-2.5 pr-12 transition-colors",
          active ? "bg-brand-50 shadow-[inset_3px_0_0_theme(colors.brand.500)]" : "hover:bg-canvas",
        )}
      >
        {row.kind === "direct" ? (
          <Avatar name={row.title} path={other?.avatar_path} userId={row.other_user_id ?? undefined} availability={other?.availability} showPresence profileCard size="md" />
        ) : row.kind === "channel" ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Hash className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E7EEFF] text-[#2B4C9B]">
            <Users className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={clsx("flex min-w-0 items-center gap-1 text-sm", unread ? "font-semibold text-ink-900" : "font-medium text-ink-800")}>
              <span className="truncate">{row.title}</span>
              {row.kind === "channel" && row.team_name ? <span className="shrink-0 truncate text-xs font-normal text-ink-400">· {row.team_name}</span> : null}
            </span>
            <time className={clsx("shrink-0 text-[11px]", unread ? "font-semibold text-brand-700" : "text-ink-400")} dateTime={row.last_message_at}>
              {listTime(row.last_message_at)}
            </time>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {row.is_favorite ? <Star className="h-3 w-3 shrink-0 fill-brand-500 text-brand-500" aria-label="Favorite" /> : null}
            {row.is_pinned ? <Pin className="h-3 w-3 shrink-0 text-ink-400" aria-label="Pinned" /> : null}
            {row.is_muted ? <BellOff className="h-3 w-3 shrink-0 text-ink-400" aria-label="Muted" /> : null}
            <span className={clsx("min-w-0 flex-1 truncate text-xs", unread ? "text-ink-800" : "text-ink-500")}>{preview}</span>
            {unread && !row.is_muted && row.is_marked_unread && row.unread_count === 1 ? (
              <span className="h-2.5 w-2.5 rounded-full bg-brand-600" aria-label="Marked as unread" />
            ) : unread && !row.is_muted ? (
              <CountBadge count={row.unread_count} />
            ) : null}
            {unread && row.is_muted ? <span className="h-2 w-2 rounded-full bg-ink-300" aria-label="Unread" /> : null}
          </span>
        </span>
      </Link>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
        <Menu
          label={`Options for ${row.title}`}
          trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
          triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
          items={[
            { label: "Pop out chat", icon: <SquareArrowOutUpRight className="h-4 w-4" aria-hidden="true" />, onSelect: onPopOut },
            { type: "separator" },
            unread
              ? { label: "Mark as read", icon: <CheckCheck className="h-4 w-4" aria-hidden="true" />, onSelect: onMarkRead }
              : { label: "Mark as unread", icon: <MailWarning className="h-4 w-4" aria-hidden="true" />, onSelect: onMarkUnread },
            {
              label: row.is_pinned ? "Unpin" : "Pin",
              icon: row.is_pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />,
              onSelect: () => onPref({ p_is_pinned: !row.is_pinned }),
            },
            {
              label: row.is_muted ? "Unmute" : "Mute",
              icon: row.is_muted ? <Bell className="h-4 w-4" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />,
              onSelect: () => onPref({ p_is_muted: !row.is_muted }),
            },
            {
              label: row.is_favorite ? "Remove from favorites" : "Add to favorites",
              icon: row.is_favorite ? <StarOff className="h-4 w-4" aria-hidden="true" /> : <Star className="h-4 w-4" aria-hidden="true" />,
              onSelect: () => onPref({ p_is_favorite: !row.is_favorite }),
            },
            { label: "Get link to chat", icon: <Link2 className="h-4 w-4" aria-hidden="true" />, onSelect: onCopyLink },
            ...(row.kind !== "channel"
              ? ([
                  { label: "Hide", icon: <EyeOff className="h-4 w-4" aria-hidden="true" />, onSelect: onHide },
                  { type: "separator" },
                  { label: "Delete chat", icon: <Trash2 className="h-4 w-4" aria-hidden="true" />, danger: true, onSelect: onDelete },
                ] as const)
              : []),
          ]}
        />
      </div>
    </li>
  );
}

