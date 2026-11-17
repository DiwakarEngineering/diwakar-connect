"use client";

import { useEffect, useMemo, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import type { Person } from "@/components/providers/people-provider";
import { fullDateTime } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/states";
import { SidePanel } from "./side-panel";
import { Sticker } from "./stickers";
import type { MessagesApi } from "./use-messages";
import { MESSAGE_COLUMNS, type Message } from "./types";

/**
 * Pinned messages, newest pin first. Pins live on the message rows, so they
 * update for everyone in real time through the existing message subscription.
 */
export function PinnedPanel({
  conversationId,
  api,
  people,
  canPin,
  onJump,
  onUnpin,
  onClose,
}: {
  conversationId: string;
  api: MessagesApi;
  people: Map<string, Person>;
  canPin: boolean;
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
  onClose: () => void;
}) {
  // Pins on older messages that are not loaded in the timeline come from the server.
  const [server, setServer] = useState<Message[]>([]);
  const pinSignature = useMemo(
    () =>
      Array.from(api.store.messages.values())
        .map((m) => (m.pinned_at ? m.id : ""))
        .join(","),
    [api.store.messages],
  );
  useEffect(() => {
    let cancelled = false;
    void getSupabaseBrowserClient()
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .not("pinned_at", "is", null)
      .is("deleted_at", null)
      .order("pinned_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) setServer(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, pinSignature]);

  const pinned = useMemo(() => {
    const byId = new Map<string, Message>();
    for (const m of server) byId.set(m.id, m);
    // Loaded messages carry the live (realtime) state.
    for (const m of api.store.messages.values()) if (byId.has(m.id) || m.pinned_at) byId.set(m.id, m);
    return Array.from(byId.values())
      .filter((m) => m.pinned_at && !m.deleted_at)
      .sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""));
  }, [api.store.messages, server]);

  return (
    <SidePanel title="Pinned messages" onClose={onClose}>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {pinned.length === 0 ? (
          <EmptyState
            icon={<Pin className="h-5 w-5" aria-hidden="true" />}
            title="No pinned messages"
            description="Pin important messages from a message's menu so everyone can find them here."
          />
        ) : (
          <ul aria-label="Pinned messages" className="divide-y divide-line">
            {pinned.map((m) => {
              const sender = m.sender_id ? people.get(m.sender_id) : undefined;
              const pinner = m.pinned_by ? people.get(m.pinned_by) : undefined;
              return (
                <li key={m.id} className="group flex gap-3 px-4 py-3">
                  <Avatar name={sender?.display_name ?? "Former employee"} path={sender?.avatar_path} userId={m.sender_id ?? undefined} size="sm" />
                  <button type="button" onClick={() => onJump(m.id)} className="min-w-0 flex-1 text-left" title="Show in conversation">
                    <span className="block text-sm font-semibold text-ink-900">{sender?.display_name ?? "Former employee"}</span>
                    {m.sticker ? <Sticker id={m.sticker} size="sm" /> : null}
                    {m.body ? <span className="line-clamp-3 block whitespace-pre-wrap text-sm text-ink-700">{m.body}</span> : null}
                    {!m.body && !m.sticker ? <span className="block text-sm italic text-ink-500">Attachment</span> : null}
                    <span className="mt-0.5 block text-[11px] text-ink-400">
                      Pinned{pinner ? ` by ${pinner.display_name}` : ""} · {fullDateTime(m.pinned_at)}
                    </span>
                  </button>
                  {canPin ? (
                    <button
                      type="button"
                      onClick={() => onUnpin(m.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                      aria-label="Unpin message"
                      title="Unpin"
                    >
                      <PinOff className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SidePanel>
  );
}
