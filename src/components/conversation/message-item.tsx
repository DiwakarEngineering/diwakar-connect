"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { AlertCircle, Copy, CornerUpLeft, MessageSquareReply, MoreHorizontal, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, type MenuItem } from "@/components/ui/menu";
import type { Person } from "@/components/providers/people-provider";
import { QUICK_REACTIONS } from "@/lib/constants";
import { fullDateTime, messageTime } from "@/lib/format";
import { MessageBody } from "./message-body";
import { AttachmentList } from "./attachment-view";
import { EmojiPicker } from "./emoji-picker";
import type { Attachment, Message, Reaction } from "./types";

export type MessageItemProps = {
  currentUserId: string;
  message: Message;
  sender: Person | undefined;
  isOwn: boolean;
  grouped: boolean;
  reactions: Reaction[];
  attachments: Attachment[];
  replyCount: number;
  parent: Message | undefined;
  parentSenderName: string | undefined;
  mentionNames: string[];
  reactorNames: (userIds: string[]) => string;
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  highlighted?: boolean;
  seenLabel?: string | null;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
  onSaveEdit: (message: Message, body: string) => Promise<boolean>;
  onDelete: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onRetry: (message: Message) => void;
  onDiscard: (message: Message) => void;
  onCopy: (message: Message) => void;
};

function ReplyQuote({ parent, name }: { parent: Message | undefined; name: string | undefined }) {
  if (!parent) {
    return <div className="mb-1 rounded-lg border-l-2 border-ink-200 bg-ink-100/60 px-2.5 py-1 text-xs italic text-ink-500">Original message unavailable</div>;
  }
  return (
    <div className="mb-1 rounded-lg border-l-2 border-brand-400 bg-brand-50/60 px-2.5 py-1">
      <div className="text-xs font-semibold text-ink-700">{name ?? "Unknown"}</div>
      <div className="line-clamp-2 text-xs text-ink-600">
        {parent.deleted_at ? <em>Message deleted</em> : parent.body || <em>Attachment</em>}
      </div>
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<boolean>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  async function save() {
    if (!value.trim() || saving) return;
    setSaving(true);
    const ok = await onSave(value.trim());
    setSaving(false);
    if (ok) onCancel();
  }
  return (
    <div className="mt-1 rounded-xl border border-brand-300 bg-white p-2 shadow-card">
      <label className="sr-only" htmlFor={id}>
        Edit message
      </label>
      <textarea
        id={id}
        ref={ref}
        value={value}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        maxLength={8000}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        className="w-full resize-none border-0 bg-transparent p-1 text-sm text-ink-900 focus:outline-none focus:ring-0"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-ink-400">Enter to save · Esc to cancel</span>
        <button type="button" onClick={onCancel} className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !value.trim()}
          className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const {
    message,
    sender,
    isOwn,
    grouped,
    reactions,
    attachments,
    replyCount,
    parent,
    parentSenderName,
    mentionNames,
    reactorNames,
    canEdit,
    canDelete,
    canReact,
    highlighted,
    seenLabel,
  } = props;
  const [editing, setEditing] = useState(false);
  const senderName = sender?.display_name ?? (message.sender_id ? "Former employee" : "Diwakar Connect");
  const deleted = !!message.deleted_at;

  if (message.kind === "system") {
    return (
      <div className="flex justify-center px-4 py-1.5" id={`m-${message.id}`}>
        <span className="rounded-full bg-ink-100 px-3 py-1 text-xs text-ink-600">
          {message.sender_id ? <span className="font-medium text-ink-800">{senderName} </span> : null}
          {message.body}
          <span className="text-ink-400"> · {messageTime(message.created_at)}</span>
        </span>
      </div>
    );
  }

  const grouped_reactions = new Map<string, string[]>();
  for (const r of reactions) grouped_reactions.set(r.emoji, [...(grouped_reactions.get(r.emoji) ?? []), r.user_id]);

  const actions: MenuItem[] = [];
  if (!deleted && !message.pending && !message.failed) {
    if (props.onReply) actions.push({ label: "Reply", icon: <CornerUpLeft className="h-4 w-4" />, onSelect: () => props.onReply?.(message) });
    if (props.onOpenThread) actions.push({ label: "Open thread", icon: <MessageSquareReply className="h-4 w-4" />, onSelect: () => props.onOpenThread?.(message) });
    if (message.body) actions.push({ label: "Copy text", icon: <Copy className="h-4 w-4" />, onSelect: () => props.onCopy(message) });
    if (canEdit) actions.push({ label: "Edit", icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditing(true) });
    if (canDelete) {
      actions.push({ type: "separator" });
      actions.push({
        label: isOwn ? "Delete" : "Delete (moderate)",
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        onSelect: () => props.onDelete(message),
      });
    }
  }

  return (
    <div
      id={`m-${message.id}`}
      className={clsx(
        "group relative flex gap-3 px-4 transition-colors md:px-6",
        grouped ? "pt-0.5" : "pt-3",
        highlighted ? "bg-brand-50" : "hover:bg-canvas",
        message.pending && "opacity-70",
      )}
    >
      <div className="w-9 shrink-0">
        {!grouped ? (
          <Avatar name={senderName} path={sender?.avatar_path} userId={message.sender_id ?? undefined} size="sm" className="mt-0.5" />
        ) : (
          <span className="invisible block pt-1 text-[10px] text-ink-400 group-hover:visible">{messageTime(message.created_at)}</span>
        )}
      </div>

      <div className="min-w-0 flex-1 pb-1">
        {!grouped ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-ink-900">{senderName}</span>
            <time dateTime={message.created_at} title={fullDateTime(message.created_at)} className="text-xs text-ink-400">
              {messageTime(message.created_at)}
            </time>
          </div>
        ) : (
          <span className="sr-only">
            {senderName}, {messageTime(message.created_at)}
          </span>
        )}

        {message.reply_to_id && !deleted ? <ReplyQuote parent={parent} name={parentSenderName} /> : null}

        {deleted ? (
          <p className="text-sm italic text-ink-400">
            {message.deleted_by && message.deleted_by !== message.sender_id ? "This message was removed by an administrator" : "This message was deleted"}
          </p>
        ) : editing ? (
          <EditBox initial={message.body} onSave={(body) => props.onSaveEdit(message, body)} onCancel={() => setEditing(false)} />
        ) : (
          <>
            {message.body ? <MessageBody body={message.body} mentionNames={mentionNames} isOwn={isOwn} /> : null}
            {message.edited_at ? (
              <span className="text-[11px] text-ink-400" title={`Edited ${fullDateTime(message.edited_at)}`}>
                (edited)
              </span>
            ) : null}
            <AttachmentList attachments={attachments} />
          </>
        )}

        {message.failed ? (
          <div role="alert" className="mt-1 flex items-center gap-2 text-xs text-danger-600">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Not sent.
            <button type="button" onClick={() => props.onRetry(message)} className="font-semibold underline">
              Retry
            </button>
            <button type="button" onClick={() => props.onDiscard(message)} className="text-ink-500 underline">
              Discard
            </button>
          </div>
        ) : message.pending ? (
          <span className="text-[11px] text-ink-400">Sending...</span>
        ) : null}

        {grouped_reactions.size > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {Array.from(grouped_reactions.entries()).map(([emoji, users]) => (
              <ReactionChip
                key={emoji}
                emoji={emoji}
                count={users.length}
                label={reactorNames(users)}
                disabled={!canReact}
                mine={users.includes(props.currentUserId)}
                onClick={() => props.onReact(message, emoji)}
              />
            ))}
          </div>
        ) : null}

        {replyCount > 0 && props.onOpenThread ? (
          <button
            type="button"
            onClick={() => props.onOpenThread?.(message)}
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
          >
            <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" />
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}

        {seenLabel ? <div className="mt-0.5 text-right text-[11px] text-ink-400">{seenLabel}</div> : null}
      </div>

      {actions.length > 0 && !editing ? (
        <div className="absolute -top-3 right-4 flex items-center gap-0.5 rounded-lg border border-line bg-white p-0.5 opacity-0 shadow-card transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:right-6">
          {canReact
            ? QUICK_REACTIONS.slice(0, 3).map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => props.onReact(message, emoji)}
                  className="hidden h-7 w-7 items-center justify-center rounded-md text-sm hover:bg-ink-100 sm:flex"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))
            : null}
          {canReact ? (
            <EmojiPicker
              label="Add reaction"
              onPick={(emoji) => props.onReact(message, emoji)}
              trigger={<SmilePlus className="h-4 w-4" aria-hidden="true" />}
              triggerClassName="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            />
          ) : null}
          {props.onReply ? (
            <button
              type="button"
              onClick={() => props.onReply?.(message)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
              aria-label="Reply"
            >
              <CornerUpLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <Menu
            label="More message actions"
            items={actions}
            trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
            triggerClassName="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          />
        </div>
      ) : null}
    </div>
  );
});

function ReactionChip({
  emoji,
  count,
  label,
  disabled,
  onClick,
  mine,
}: {
  emoji: string;
  count: number;
  label: string;
  disabled: boolean;
  onClick: () => void;
  mine: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-pressed={mine}
      aria-label={`${emoji} ${count}: ${label}`}
      className={clsx(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
        mine ? "border-brand-300 bg-brand-50 text-brand-800" : "border-line bg-white text-ink-700 hover:border-ink-200",
      )}
    >
      <span>{emoji}</span>
      <span className="font-medium">{count}</span>
    </button>
  );
}
