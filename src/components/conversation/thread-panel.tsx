"use client";

import { useEffect, useMemo, useState } from "react";
import type { Person } from "@/components/providers/people-provider";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { MessageItem } from "./message-item";
import { Composer } from "./composer";
import { SidePanel } from "./side-panel";
import type { MessagesApi } from "./use-messages";
import type { MessagePermissions } from "./message-list";
import type { Message, SendInput } from "./types";

type Props = {
  rootId: string;
  api: MessagesApi;
  people: Map<string, Person>;
  me: string;
  permissions: MessagePermissions;
  mentionCandidates: Person[];
  maxAttachmentMb: number;
  disabledReason: string | null;
  onClose: () => void;
  onSaveEdit: (m: Message, body: string) => Promise<boolean>;
  onDelete: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onCopy: (m: Message) => void;
};

/** A message and every reply to it, with a composer that replies in-thread. */
export function ThreadPanel(props: Props) {
  const { rootId, api, people, me } = props;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const { loadThread } = api;

  useEffect(() => {
    setStatus("loading");
    loadThread(rootId)
      .then(() => setStatus("ready"))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Couldn't load the thread.");
        setStatus("error");
      });
  }, [loadThread, rootId]);

  const root = api.store.messages.get(rootId);
  const replies = useMemo(
    () =>
      Array.from(api.store.messages.values())
        .filter((m) => m.reply_to_id === rootId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [api.store.messages, rootId],
  );

  const reactorNames = (ids: string[]) =>
    ids.map((id) => (id === me ? "You" : (people.get(id)?.display_name ?? "Someone"))).join(", ");

  const render = (m: Message) => (
    <MessageItem
      key={m.id}
      currentUserId={me}
      message={m}
      sender={m.sender_id ? people.get(m.sender_id) : undefined}
      isOwn={m.sender_id === me}
      grouped={false}
      reactions={api.store.reactions.get(m.id) ?? []}
      attachments={api.store.attachments.get(m.id) ?? []}
      replyCount={0}
      parent={undefined}
      parentSenderName={undefined}
      mentionNames={m.mentions.map((id) => people.get(id)?.display_name).filter((n): n is string => !!n)}
      reactorNames={reactorNames}
      canEdit={props.permissions.canEdit(m)}
      canDelete={props.permissions.canDelete(m)}
      canReact={props.permissions.canReact}
      onSaveEdit={props.onSaveEdit}
      onDelete={props.onDelete}
      onReact={props.onReact}
      onRetry={(msg) => void api.retryFailed(msg.id)}
      onDiscard={(msg) => api.discardFailed(msg.id)}
      onCopy={props.onCopy}
    />
  );

  return (
    <SidePanel title="Thread" onClose={props.onClose}>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-2">
        {status === "loading" && !root ? (
          <LoadingState label="Loading thread" />
        ) : status === "error" ? (
          <ErrorState message={error ?? "Couldn't load the thread."} />
        ) : root ? (
          <>
            {render({ ...root, reply_to_id: null })}
            <div className="mx-4 my-2 flex items-center gap-2 text-xs text-ink-400">
              <span className="h-px flex-1 bg-line" />
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
              <span className="h-px flex-1 bg-line" />
            </div>
            {replies.map((m) => render({ ...m, reply_to_id: null }))}
          </>
        ) : (
          <ErrorState message="This message is no longer available." />
        )}
      </div>
      <Composer
        compact
        autoFocus
        placeholder="Reply in thread"
        disabledReason={props.disabledReason}
        mentionCandidates={props.mentionCandidates}
        maxAttachmentMb={props.maxAttachmentMb}
        onSend={(input: SendInput) => api.send({ ...input, replyToId: rootId })}
      />
    </SidePanel>
  );
}
