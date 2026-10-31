"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, MessageSquareDashed } from "lucide-react";
import type { Person } from "@/components/providers/people-provider";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import { dayLabel } from "@/lib/format";
import { MessageItem } from "./message-item";
import type { MessagesApi } from "./use-messages";
import type { Message } from "./types";

const GROUP_WINDOW_MS = 5 * 60_000;

export type MessagePermissions = {
  canEdit: (m: Message) => boolean;
  canDelete: (m: Message) => boolean;
  canReact: boolean;
};

type Props = {
  api: MessagesApi;
  people: Map<string, Person>;
  me: string;
  permissions: MessagePermissions;
  emptyTitle: string;
  emptyDescription: string;
  seenLabelFor: (m: Message) => string | null;
  highlightedId: string | null;
  typingLabel: string | null;
  onReply?: (m: Message) => void;
  onOpenThread?: (m: Message) => void;
  onSaveEdit: (m: Message, body: string) => Promise<boolean>;
  onDelete: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onCopy: (m: Message) => void;
};

export function MessageList(props: Props) {
  const { api, people, me } = props;
  const { store, status, error, hasMore, loadingOlder } = api;
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevEdges = useRef<{ first?: string; last?: string; height: number; top: number }>({ height: 0, top: 0 });
  const nearBottom = useRef(true);
  const [unseen, setUnseen] = useState(0);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setUnseen(0);
  }, []);

  // Keep position stable when older messages are prepended; follow new ones at the bottom.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const first = store.timeline[0];
    const last = store.timeline[store.timeline.length - 1];
    const prev = prevEdges.current;
    if (prev.first && first !== prev.first && last === prev.last) {
      el.scrollTop = el.scrollHeight - prev.height + prev.top;
    } else if (last !== prev.last) {
      const lastMsg = last ? store.messages.get(last) : undefined;
      if (!prev.last || nearBottom.current || lastMsg?.sender_id === me) {
        el.scrollTop = el.scrollHeight;
      } else {
        setUnseen((n) => n + 1);
      }
    }
    prevEdges.current = { first, last, height: el.scrollHeight, top: el.scrollTop };
  }, [me, store.messages, store.timeline]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = containerRef.current;
    if (!sentinel || !root || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          const el = containerRef.current;
          if (el) prevEdges.current = { ...prevEdges.current, height: el.scrollHeight, top: el.scrollTop };
          void api.loadOlder();
        }
      },
      { root, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [api, hasMore, status]);

  useEffect(() => {
    if (!props.highlightedId) return;
    document.getElementById(`m-${props.highlightedId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [props.highlightedId]);

  if (status === "loading") return <div className="flex-1 overflow-hidden"><SkeletonRows rows={7} /></div>;
  if (status === "error") return <ErrorState message={error ?? "Couldn't load messages."} onRetry={() => void api.reload()} className="flex-1" />;

  const reactorNames = (ids: string[]) =>
    ids.map((id) => (id === me ? "You" : (people.get(id)?.display_name ?? "Someone"))).join(", ");

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          if (nearBottom.current && unseen) setUnseen(0);
          prevEdges.current = { ...prevEdges.current, height: el.scrollHeight, top: el.scrollTop };
        }}
        className="scrollbar-thin h-full overflow-y-auto pb-3"
        role="log"
        aria-label="Messages"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div ref={sentinelRef} aria-hidden="true" />
        {hasMore ? (
          <div className="flex justify-center py-3">
            {loadingOlder ? (
              <Spinner className="h-4 w-4 text-ink-400" label="Loading older messages" />
            ) : (
              <button type="button" onClick={() => void api.loadOlder()} className="text-xs font-medium text-brand-700 hover:underline">
                Load older messages
              </button>
            )}
          </div>
        ) : store.timeline.length > 0 ? (
          <p className="py-4 text-center text-xs text-ink-400">This is the beginning of the conversation.</p>
        ) : null}

        {store.timeline.length === 0 ? (
          <EmptyState
            icon={<MessageSquareDashed className="h-5 w-5" aria-hidden="true" />}
            title={props.emptyTitle}
            description={props.emptyDescription}
            className="h-full"
          />
        ) : null}

        {store.timeline.map((id, index) => {
          const m = store.messages.get(id);
          if (!m) return null;
          const prevMsg = index > 0 ? store.messages.get(store.timeline[index - 1]!) : undefined;
          const newDay = !prevMsg || new Date(prevMsg.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const grouped =
            !newDay &&
            !!prevMsg &&
            prevMsg.kind === "user" &&
            m.kind === "user" &&
            prevMsg.sender_id === m.sender_id &&
            !m.reply_to_id &&
            new Date(m.created_at).getTime() - new Date(prevMsg.created_at).getTime() < GROUP_WINDOW_MS;
          const parent = m.reply_to_id ? store.messages.get(m.reply_to_id) : undefined;
          const sender = m.sender_id ? people.get(m.sender_id) : undefined;
          const mentionNames = m.mentions.map((uid) => people.get(uid)?.display_name).filter((n): n is string => !!n);
          return (
            <Fragment key={id}>
              {newDay ? (
                <div className="sticky top-0 z-10 flex justify-center py-2" role="separator" aria-label={dayLabel(m.created_at)}>
                  <span className="rounded-full border border-line bg-white/95 px-3 py-0.5 text-xs font-medium text-ink-600 shadow-card backdrop-blur">
                    {dayLabel(m.created_at)}
                  </span>
                </div>
              ) : null}
              <MessageItem
                currentUserId={me}
                message={m}
                sender={sender}
                isOwn={m.sender_id === me}
                grouped={grouped}
                reactions={store.reactions.get(id) ?? []}
                attachments={store.attachments.get(id) ?? []}
                replyCount={store.replyCounts.get(id) ?? 0}
                parent={parent}
                parentSenderName={parent?.sender_id ? people.get(parent.sender_id)?.display_name : undefined}
                mentionNames={mentionNames}
                reactorNames={reactorNames}
                canEdit={props.permissions.canEdit(m)}
                canDelete={props.permissions.canDelete(m)}
                canReact={props.permissions.canReact}
                highlighted={props.highlightedId === id}
                seenLabel={props.seenLabelFor(m)}
                onReply={props.onReply}
                onOpenThread={props.onOpenThread}
                onSaveEdit={props.onSaveEdit}
                onDelete={props.onDelete}
                onReact={props.onReact}
                onRetry={(msg) => void api.retryFailed(msg.id)}
                onDiscard={(msg) => api.discardFailed(msg.id)}
                onCopy={props.onCopy}
              />
            </Fragment>
          );
        })}
      </div>

      {props.typingLabel ? (
        <div className="pointer-events-none absolute bottom-1 left-4 text-xs italic text-ink-500 md:left-6" aria-live="polite">
          {props.typingLabel}
        </div>
      ) : null}

      {unseen > 0 ? (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-pop hover:bg-brand-700"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          {unseen} new {unseen === 1 ? "message" : "messages"}
        </button>
      ) : null}
    </div>
  );
}
