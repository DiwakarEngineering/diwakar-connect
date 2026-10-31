"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { BellOff, MessageSquarePlus, MoreHorizontal, Pin, Search, Users } from "lucide-react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { listTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/badge";
import { Menu } from "@/components/ui/menu";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { NewChatDialog } from "./new-chat-dialog";

type Row = RpcRow<"list_my_conversations">;
type Filter = "all" | "unread" | "pinned";

/** Searchable, filterable list of direct and group chats with live unread counts. */
export function ConversationList() {
  const pathname = usePathname();
  const { session } = useSession();
  const { messageTick, refresh: refreshActivity } = useActivity();
  const { push } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const supabase = getSupabaseBrowserClient();

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc("list_my_conversations", {
      p_unread_only: filter === "unread",
      p_search: search.trim() || null,
      p_limit: 200,
    });
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load chats."));
      return;
    }
    setError(null);
    setRows(filter === "pinned" ? (data ?? []).filter((r) => r.is_pinned) : (data ?? []));
  }, [filter, search, supabase]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [load, search, messageTick, pathname]);

  const people = usePeopleById((rows ?? []).flatMap((r) => [r.other_user_id, r.last_sender_id]));

  async function setPref(row: Row, patch: { p_is_pinned?: boolean; p_is_muted?: boolean }) {
    const { error: prefError } = await supabase.rpc("set_conversation_preferences", {
      p_conversation_id: row.conversation_id,
      ...patch,
    });
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

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread" },
    { id: "pinned", label: "Pinned" },
  ];

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="hidden text-lg font-semibold text-ink-900 md:block">Chat</h1>
        <Button variant="primary" size="sm" onClick={() => setNewOpen(true)} className="md:ml-auto">
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          New chat
        </Button>
      </div>
      <div className="space-y-2 px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm placeholder:text-ink-400 focus:bg-white"
          />
        </div>
        <div role="tablist" aria-label="Filter chats" className="flex gap-1">
          {filters.map((f) => (
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
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<MessageSquarePlus className="h-5 w-5" aria-hidden="true" />}
            title={search ? "No chats match" : filter === "unread" ? "You're all caught up" : filter === "pinned" ? "No pinned chats" : "No chats yet"}
            description={search || filter !== "all" ? undefined : "Start a conversation with a colleague or a group."}
            action={
              !search && filter === "all" ? (
                <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
                  Start a chat
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul aria-label="Chats">
            {rows.map((row) => {
              const href = `/chat/${row.conversation_id}`;
              const active = pathname === href;
              const other = row.other_user_id ? people.get(row.other_user_id) : undefined;
              const sender = row.last_sender_id
                ? row.last_sender_id === session.userId
                  ? "You"
                  : people.get(row.last_sender_id)?.display_name?.split(" ")[0]
                : undefined;
              const preview =
                row.last_message_preview === null
                  ? "No messages yet"
                  : row.last_message_kind === "system"
                    ? `${row.last_sender_id ? (sender ?? "Someone") + " " : ""}${row.last_message_preview}`
                    : row.kind === "group" || row.last_sender_id === session.userId
                      ? `${sender ?? "Someone"}: ${row.last_message_preview}`
                      : row.last_message_preview;
              const unread = row.unread_count > 0;
              return (
                <li key={row.conversation_id} className="group relative">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "flex items-center gap-3 px-4 py-3 pr-12 transition-colors",
                      active ? "bg-brand-50" : "hover:bg-canvas",
                    )}
                  >
                    {row.kind === "direct" ? (
                      <Avatar
                        name={row.title}
                        path={other?.avatar_path}
                        userId={row.other_user_id ?? undefined}
                        availability={other?.availability}
                        showPresence
                        size="md"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E7EEFF] text-[#2B4C9B]">
                        <Users className="h-4 w-4" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={clsx("truncate text-sm", unread ? "font-semibold text-ink-900" : "font-medium text-ink-800")}>
                          {row.title}
                        </span>
                        <time className={clsx("shrink-0 text-[11px]", unread ? "font-semibold text-brand-700" : "text-ink-400")} dateTime={row.last_message_at}>
                          {listTime(row.last_message_at)}
                        </time>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {row.is_pinned ? <Pin className="h-3 w-3 shrink-0 text-ink-400" aria-label="Pinned" /> : null}
                        {row.is_muted ? <BellOff className="h-3 w-3 shrink-0 text-ink-400" aria-label="Muted" /> : null}
                        <span className={clsx("min-w-0 flex-1 truncate text-xs", unread ? "text-ink-800" : "text-ink-500")}>{preview}</span>
                        {unread && !row.is_muted ? <CountBadge count={row.unread_count} /> : null}
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
                        { label: row.is_pinned ? "Unpin" : "Pin", onSelect: () => void setPref(row, { p_is_pinned: !row.is_pinned }) },
                        { label: row.is_muted ? "Unmute" : "Mute", onSelect: () => void setPref(row, { p_is_muted: !row.is_muted }) },
                        { label: "Mark as read", disabled: !unread, onSelect: () => void markRead(row) },
                      ]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <NewChatDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
