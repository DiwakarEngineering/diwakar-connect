"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareOff } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { callsAvailable, useActiveCall, useCallConfig } from "@/components/calls/use-call-config";
import { useConversationMeta } from "./use-conversation-meta";
import { useMessages } from "./use-messages";
import { useTyping } from "./use-typing";
import { ConversationHeader } from "./conversation-header";
import { MessageList, type MessagePermissions } from "./message-list";
import { Composer } from "./composer";
import { ThreadPanel } from "./thread-panel";
import { MembersPanel } from "./members-panel";
import { SearchPanel } from "./search-panel";
import type { ConversationMeta, Message } from "./types";

type Panel = { type: "thread"; rootId: string } | { type: "members" } | { type: "search" } | null;

/** A full conversation (direct, group or channel): header, history, composer and side panels. */
export function ConversationView({ conversationId, backHref }: { conversationId: string; backHref: string }) {
  const { state, reload: reloadMeta, patch } = useConversationMeta(conversationId);

  if (state.status === "loading") return <LoadingState label="Opening conversation" className="h-full" />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={() => void reloadMeta()} className="h-full" />;
  if (state.status === "not-found") {
    return (
      <EmptyState
        icon={<MessageSquareOff className="h-5 w-5" aria-hidden="true" />}
        title="Conversation not available"
        description="It may have been removed, or you're not a member."
        className="h-full"
      />
    );
  }
  return <ReadyConversation key={conversationId} meta={state.meta} backHref={backHref} reloadMeta={reloadMeta} patchMeta={patch} />;
}

function ReadyConversation({
  meta,
  backHref,
  reloadMeta,
  patchMeta,
}: {
  meta: ConversationMeta;
  backHref: string;
  reloadMeta: () => Promise<void>;
  patchMeta: ReturnType<typeof useConversationMeta>["patch"];
}) {
  const router = useRouter();
  const { session, isAdmin } = useSession();
  const { refresh: refreshActivity } = useActivity();
  const { push } = useToast();
  const me = session.userId;
  const api = useMessages(meta.id, meta.clearedAt);
  const { typingUserIds, notifyTyping, notifyStopped } = useTyping(meta.id, me);
  const callConfig = useCallConfig();
  const activeCall = useActiveCall(meta.id);
  const [panel, setPanel] = useState<Panel>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(meta.groupTitle ?? "");
  const [receipts, setReceipts] = useState<Map<string, string>>(new Map());
  const supabase = getSupabaseBrowserClient();

  const senderIds = useMemo(() => {
    const ids = new Set(meta.memberIds);
    for (const m of api.store.messages.values()) {
      if (m.sender_id) ids.add(m.sender_id);
      for (const id of m.mentions) ids.add(id);
    }
    for (const list of api.store.reactions.values()) for (const r of list) ids.add(r.user_id);
    return Array.from(ids);
  }, [api.store.messages, api.store.reactions, meta.memberIds]);
  const people = usePeopleById(senderIds);

  // --- Read state -----------------------------------------------------------
  const lastId = api.store.timeline[api.store.timeline.length - 1];
  const markTimer = useRef<number | null>(null);
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      if (markTimer.current !== null) window.clearTimeout(markTimer.current);
      markTimer.current = window.setTimeout(async () => {
        await supabase.rpc("mark_conversation_read", { p_conversation_id: meta.id });
        refreshActivity();
      }, 600);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [lastId, meta.id, refreshActivity, supabase]);

  // "Seen" markers for direct and group chats.
  const loadReceipts = useCallback(async () => {
    if (meta.kind === "channel") return;
    const { data } = await supabase.rpc("get_read_receipts", { p_conversation_id: meta.id });
    setReceipts(new Map((data ?? []).map((r) => [r.user_id, r.last_read_at])));
  }, [meta.id, meta.kind, supabase]);
  useEffect(() => {
    void loadReceipts();
    const id = window.setInterval(() => void loadReceipts(), 20_000);
    return () => window.clearInterval(id);
  }, [loadReceipts, lastId]);

  const lastOwnId = useMemo(() => {
    for (let i = api.store.timeline.length - 1; i >= 0; i--) {
      const m = api.store.messages.get(api.store.timeline[i]!);
      if (m && m.sender_id === me && m.kind === "user" && !m.pending && !m.failed) return m.id;
    }
    return null;
  }, [api.store.messages, api.store.timeline, me]);

  const seenLabelFor = useCallback(
    (m: Message) => {
      if (m.id !== lastOwnId || meta.kind === "channel") return null;
      const readers = Array.from(receipts.entries())
        .filter(([, at]) => at >= m.created_at)
        .map(([uid]) => uid);
      if (readers.length === 0) return null;
      if (meta.kind === "direct") return "Seen";
      const names = readers.map((uid) => people.get(uid)?.display_name?.split(" ")[0]).filter(Boolean);
      return `Seen by ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
    },
    [lastOwnId, meta.kind, people, receipts],
  );

  // --- Permissions (mirrors database rules; the database is authoritative) ---
  const settings = session.settings;
  const permissions = useMemo<MessagePermissions>(
    () => ({
      canEdit: (m) =>
        m.sender_id === me &&
        m.kind === "user" &&
        !m.deleted_at &&
        !m.pending &&
        !m.failed &&
        meta.canPost &&
        (settings.message_edit_window_minutes === null ||
          Date.now() - new Date(m.created_at).getTime() < settings.message_edit_window_minutes * 60_000),
      canDelete: (m) =>
        m.kind === "user" &&
        !m.deleted_at &&
        !m.pending &&
        !m.failed &&
        ((m.sender_id === me && (settings.allow_message_delete || isAdmin)) || (m.sender_id !== me && isAdmin)),
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
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing...`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
    return "Several people are typing...";
  }, [people, typingUserIds]);

  // --- Actions --------------------------------------------------------------
  const onSaveEdit = useCallback(
    async (m: Message, body: string) => {
      const mentions = m.mentions.filter((id) => {
        const name = people.get(id)?.display_name;
        return !!name && body.includes(`@${name}`);
      });
      try {
        await api.edit(m.id, body, mentions);
        return true;
      } catch (e) {
        push({ tone: "error", title: "Couldn't edit message", description: e instanceof Error ? e.message : undefined });
        return false;
      }
    },
    [api, people, push],
  );

  const onReact = useCallback(
    (m: Message, emoji: string) => {
      api.toggleReaction(m.id, emoji).catch((e: unknown) =>
        push({ tone: "error", title: "Reaction not saved", description: e instanceof Error ? e.message : undefined }),
      );
    },
    [api, push],
  );

  const onCopy = useCallback(
    (m: Message) => {
      // navigator.clipboard only exists on HTTPS/localhost; fall back for LAN addresses.
      const write = navigator.clipboard
        ? navigator.clipboard.writeText(m.body)
        : new Promise<void>((resolve, reject) => {
            const el = document.createElement("textarea");
            el.value = m.body;
            el.style.position = "fixed";
            el.style.opacity = "0";
            document.body.appendChild(el);
            el.select();
            const ok = document.execCommand("copy");
            el.remove();
            if (ok) resolve();
            else reject(new Error("copy failed"));
          });
      void write
        .then(() => push({ tone: "success", title: "Copied to clipboard" }))
        .catch(() => push({ tone: "error", title: "Couldn't copy" }));
    },
    [push],
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.remove(pendingDelete.id);
      setPendingDelete(null);
    } catch (e) {
      push({ tone: "error", title: "Couldn't delete message", description: e instanceof Error ? e.message : undefined });
    } finally {
      setDeleting(false);
    }
  }

  async function togglePref(kind: "pin" | "mute") {
    const next = kind === "pin" ? !meta.isPinned : !meta.isMuted;
    patchMeta(kind === "pin" ? { isPinned: next } : { isMuted: next });
    const { error } = await supabase.rpc("set_conversation_preferences", {
      p_conversation_id: meta.id,
      ...(kind === "pin" ? { p_is_pinned: next } : { p_is_muted: next }),
    });
    if (error) {
      patchMeta(kind === "pin" ? { isPinned: !next } : { isMuted: !next });
      push({ tone: "error", title: "Couldn't update conversation", description: friendlyError(error) });
      return;
    }
    refreshActivity();
    push({ tone: "success", title: kind === "pin" ? (next ? "Pinned" : "Unpinned") : next ? "Muted" : "Unmuted" });
  }

  async function confirmClearHistory() {
    setClearing(true);
    const { data, error } = await supabase.rpc("clear_conversation_history", { p_conversation_id: meta.id });
    setClearing(false);
    if (error) {
      push({ tone: "error", title: "Couldn't clear chat history", description: friendlyError(error) });
      return;
    }
    setClearOpen(false);
    setPanel(null);
    setReplyTo(null);
    patchMeta({ clearedAt: data });
    refreshActivity();
    push({ tone: "success", title: "Chat history cleared" });
  }

  async function saveRename() {
    const title = renameValue.trim() || null;
    const { error } = await supabase.from("conversations").update({ title }).eq("id", meta.id);
    if (error) {
      push({ tone: "error", title: "Couldn't rename group", description: friendlyError(error) });
      return;
    }
    patchMeta({ groupTitle: title });
    setRenameOpen(false);
    refreshActivity();
  }

  const replyTarget = replyTo
    ? { message: replyTo, senderName: (replyTo.sender_id && people.get(replyTo.sender_id)?.display_name) || "Unknown" }
    : null;

  const archived = meta.kind === "channel" && (!!meta.channel?.archived_at || !!meta.team?.archived_at);
  const disabledReason = meta.canPost
    ? null
    : archived
      ? "This channel is archived. You can read the history but not post."
      : "You can't post in this conversation.";

  const isChannel = meta.kind === "channel";
  const other = meta.otherUserId ? people.get(meta.otherUserId) : undefined;

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col bg-white" aria-label={meta.title}>
        <ConversationHeader
          meta={meta}
          other={other}
          backHref={backHref}
          activePanel={panel?.type ?? null}
          callsAvailable={callsAvailable(callConfig)}
          activeCall={!!activeCall}
          onTogglePanel={(p) => setPanel((cur) => (cur?.type === p ? null : { type: p }))}
          onTogglePin={() => void togglePref("pin")}
          onToggleMute={() => void togglePref("mute")}
          onRename={() => {
            setRenameValue(meta.groupTitle ?? "");
            setRenameOpen(true);
          }}
          onClearHistory={() => setClearOpen(true)}
        />
        <MessageList
          api={api}
          people={people}
          me={me}
          permissions={permissions}
          emptyTitle={isChannel ? `Welcome to #${meta.title}` : "Say hello"}
          emptyDescription={
            isChannel
              ? meta.channel?.description || "Start the conversation for your team."
              : meta.kind === "direct"
                ? `This is the start of your conversation with ${meta.title}.`
                : "This is the start of the group chat."
          }
          seenLabelFor={seenLabelFor}
          highlightedId={highlightedId}
          typingLabel={typingLabel}
          onReply={meta.canPost ? setReplyTo : undefined}
          onOpenThread={(m) => setPanel({ type: "thread", rootId: m.id })}
          onSaveEdit={onSaveEdit}
          onDelete={setPendingDelete}
          onReact={onReact}
          onCopy={onCopy}
        />
        <Composer
          placeholder={isChannel ? `Post in #${meta.title}` : `Message ${meta.title}`}
          disabledReason={disabledReason}
          mentionCandidates={mentionCandidates}
          maxAttachmentMb={settings.max_attachment_mb}
          replyTo={replyTarget}
          onCancelReply={() => setReplyTo(null)}
          onSend={api.send}
          onTyping={notifyTyping}
          onStopTyping={notifyStopped}
        />
      </section>

      {panel?.type === "thread" ? (
        <ThreadPanel
          rootId={panel.rootId}
          api={api}
          people={people}
          me={me}
          permissions={permissions}
          mentionCandidates={mentionCandidates}
          maxAttachmentMb={settings.max_attachment_mb}
          disabledReason={disabledReason}
          onClose={() => setPanel(null)}
          onSaveEdit={onSaveEdit}
          onDelete={setPendingDelete}
          onReact={onReact}
          onCopy={onCopy}
        />
      ) : panel?.type === "members" ? (
        <MembersPanel
          meta={meta}
          people={people}
          me={me}
          onClose={() => setPanel(null)}
          onChanged={() => void reloadMeta()}
          onLeft={() => {
            refreshActivity();
            router.push("/chat");
          }}
        />
      ) : panel?.type === "search" ? (
        <SearchPanel
          conversationId={meta.id}
          clearedAt={meta.clearedAt}
          people={people}
          isLoaded={(id) => api.store.timeline.includes(id)}
          onJump={(id) => {
            setHighlightedId(id);
            window.setTimeout(() => setHighlightedId(null), 2500);
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        busy={deleting}
        title="Delete message?"
        description={
          pendingDelete && pendingDelete.sender_id !== me
            ? "This removes the message for everyone. The action is recorded in the audit log."
            : "This removes the message and its files for everyone."
        }
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={clearOpen}
        busy={clearing}
        title="Clear chat history?"
        description="All messages up to now will be removed from this chat for you only. Other people keep their copy, and new messages will still appear here."
        confirmLabel="Clear history"
        onConfirm={() => void confirmClearHistory()}
        onClose={() => setClearOpen(false)}
      />

      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename group"
        size="sm"
        footer={
          <>
            <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveRename()}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Group name" hint="Leave empty to show member names.">
          <Input value={renameValue} maxLength={80} onChange={(e) => setRenameValue(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
