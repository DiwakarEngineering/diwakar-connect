"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useToast } from "@/components/ui/toast";
import { useMessages } from "@/components/conversation/use-messages";
import { useTyping } from "@/components/conversation/use-typing";
import { MessageList, type MessagePermissions } from "@/components/conversation/message-list";
import { Composer } from "@/components/conversation/composer";
import type { ConversationMeta, Message } from "@/components/conversation/types";

/**
 * Meeting chat: the call's own conversation (direct, group or channel), so the
 * history stays in the chat after the meeting. Opens beside the video without
 * interrupting the call.
 */
export function MeetingChat({ meta, onClose }: { meta: ConversationMeta; onClose: () => void }) {
  const { session, isAdmin } = useSession();
  const { push } = useToast();
  const me = session.userId;
  const api = useMessages(meta.id, meta.clearedAt);
  const { typingUserIds, notifyTyping, notifyStopped } = useTyping(meta.id, me);

  const ids = useMemo(() => {
    const s = new Set(meta.memberIds);
    for (const m of api.store.messages.values()) if (m.sender_id) s.add(m.sender_id);
    return Array.from(s);
  }, [api.store.messages, meta.memberIds]);
  const people = usePeopleById(ids);
  const settings = session.settings;

  const permissions = useMemo<MessagePermissions>(
    () => ({
      canEdit: (m: Message) =>
        m.sender_id === me &&
        m.kind === "user" &&
        !m.deleted_at &&
        !m.pending &&
        meta.canPost &&
        (settings.message_edit_window_minutes === null ||
          Date.now() - new Date(m.created_at).getTime() < settings.message_edit_window_minutes * 60_000),
      canDelete: (m: Message) =>
        m.kind === "user" && !m.deleted_at && !m.pending && ((m.sender_id === me && (settings.allow_message_delete || isAdmin)) || (m.sender_id !== me && isAdmin)),
      canReact: meta.canPost,
    }),
    [isAdmin, me, meta.canPost, settings.allow_message_delete, settings.message_edit_window_minutes],
  );

  const mentionCandidates = useMemo(
    () =>
      meta.memberIds
        .filter((id) => id !== me)
        .map((id) => people.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p && p.employment_status === "active"),
    [me, meta.memberIds, people],
  );

  const typingLabel = useMemo(() => {
    const names = typingUserIds.map((id) => people.get(id)?.display_name?.split(" ")[0]).filter(Boolean);
    if (!names.length) return null;
    return names.length === 1 ? `${names[0]} is typing...` : "Several people are typing...";
  }, [people, typingUserIds]);

  const fail = (title: string) => (e: unknown) => push({ tone: "error", title, description: e instanceof Error ? e.message : undefined });

  return (
    <aside aria-label="Meeting chat" className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-white text-ink-900 md:static md:w-[360px] md:rounded-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-sm font-semibold">Meeting chat</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Close meeting chat">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <MessageList
        api={api}
        people={people}
        me={me}
        permissions={permissions}
        emptyTitle="No messages yet"
        emptyDescription="Messages sent here stay in the conversation after the meeting."
        seenLabelFor={() => null}
        highlightedId={null}
        typingLabel={typingLabel}
        onSaveEdit={async (m, body) => {
          try {
            await api.edit(m.id, body, m.mentions);
            return true;
          } catch (e) {
            fail("Couldn't edit message")(e);
            return false;
          }
        }}
        onDelete={(m) => void api.remove(m.id).catch(fail("Couldn't delete message"))}
        onReact={(m, emoji) => void api.toggleReaction(m.id, emoji).catch(fail("Reaction not saved"))}
        onCopy={(m) => void navigator.clipboard?.writeText(m.body)}
      />
      <Composer
        compact
        placeholder="Message everyone"
        disabledReason={meta.canPost ? null : "You can't post in this conversation."}
        mentionCandidates={mentionCandidates}
        maxAttachmentMb={settings.max_attachment_mb}
        onSend={api.send}
        onTyping={notifyTyping}
        onStopTyping={notifyStopped}
      />
    </aside>
  );
}
