"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Paperclip, SendHorizontal, Smile, X, File as FileIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import type { Person } from "@/components/providers/people-provider";
import { ALLOWED_ATTACHMENT_TYPES, MAX_FILES_PER_MESSAGE, MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { fileSize } from "@/lib/format";
import { EmojiPicker } from "./emoji-picker";
import type { Message, SendInput } from "./types";

type Props = {
  placeholder: string;
  disabledReason?: string | null;
  mentionCandidates: Person[];
  maxAttachmentMb: number;
  replyTo?: { message: Message; senderName: string } | null;
  onCancelReply?: () => void;
  onSend: (input: SendInput) => Promise<void>;
  onTyping?: () => void;
  onStopTyping?: () => void;
  compact?: boolean;
  autoFocus?: boolean;
};

const ALLOWED = new Set<string>(ALLOWED_ATTACHMENT_TYPES);

export function Composer({
  placeholder,
  disabledReason,
  mentionCandidates,
  maxAttachmentMb,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
  onStopTyping,
  compact,
  autoFocus,
}: Props) {
  const { push } = useToast();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mentions, setMentions] = useState<Map<string, string>>(new Map());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hintId = useId();

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionCandidates
      .filter((p) => p.display_name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.display_name.toLowerCase().startsWith(q)) - Number(!b.display_name.toLowerCase().startsWith(q)))
      .slice(0, 6);
  }, [mentionCandidates, mentionQuery]);

  function updateMentionQuery(value: string, caret: number) {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([\p{L}\p{N} .'-]{0,30})$/u.exec(before);
    if (match && !match[2]!.includes("  ")) {
      setMentionQuery(match[2]!);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertAtCaret(insert: string, replaceBackTo?: number) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const start = replaceBackTo ?? caret;
    const next = text.slice(0, start) + insert + text.slice(caret);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + insert.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function chooseMention(person: Person) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) return;
    insertAtCaret(`@${person.display_name} `, at);
    setMentions((m) => new Map(m).set(person.id, person.display_name));
    setMentionQuery(null);
  }

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const accepted: File[] = [];
    for (const file of incoming) {
      if (!ALLOWED.has(file.type)) {
        push({ tone: "error", title: `"${file.name}" isn't an allowed file type`, description: "Images, PDFs, Office documents, text, zip, audio and video are supported." });
        continue;
      }
      if (file.size > maxAttachmentMb * 1024 * 1024) {
        push({ tone: "error", title: `"${file.name}" is too large`, description: `Files must be smaller than ${maxAttachmentMb} MB.` });
        continue;
      }
      accepted.push(file);
    }
    setFiles((current) => {
      const merged = [...current, ...accepted];
      if (merged.length > MAX_FILES_PER_MESSAGE) {
        push({ tone: "error", title: `You can attach up to ${MAX_FILES_PER_MESSAGE} files per message.` });
      }
      return merged.slice(0, MAX_FILES_PER_MESSAGE);
    });
  }

  async function submit() {
    const body = text.trim();
    if (!body && files.length === 0) return;
    if (body.length > MAX_MESSAGE_LENGTH) {
      push({ tone: "error", title: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.` });
      return;
    }
    // Keep only mentions whose @Name is still in the text.
    const mentionIds = Array.from(mentions.entries())
      .filter(([, name]) => body.includes(`@${name}`))
      .map(([id]) => id);
    const input: SendInput = { body, mentions: mentionIds, replyToId: replyTo?.message.id ?? null, files };
    setText("");
    setFiles([]);
    setMentions(new Map());
    setMentionQuery(null);
    onCancelReply?.();
    onStopTyping?.();
    try {
      await onSend(input);
    } catch (e) {
      push({ tone: "error", title: "Message not sent", description: e instanceof Error ? e.message : undefined });
    }
  }

  if (disabledReason) {
    return (
      <div className="border-t border-line bg-white px-4 py-3 text-center text-sm text-ink-500" role="status">
        {disabledReason}
      </div>
    );
  }

  const showSuggestions = mentionQuery !== null && suggestions.length > 0;

  return (
    <div
      className={clsx("border-t border-line bg-white", compact ? "p-2" : "px-3 pb-3 pt-2 md:px-6")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }
        setDragging(false);
      }}
    >
      {replyTo ? (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-brand-500 bg-brand-50/70 px-3 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-brand-800">Replying to {replyTo.senderName}</div>
            <div className="truncate text-xs text-ink-600">{replyTo.message.body || "Attachment"}</div>
          </div>
          <button type="button" onClick={onCancelReply} className="rounded p-0.5 text-ink-500 hover:text-ink-900" aria-label="Cancel reply">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div
        className={clsx(
          "relative rounded-2xl border bg-white transition-colors",
          dragging ? "border-brand-400 bg-brand-50/40" : "border-line focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100",
        )}
      >
        {showSuggestions ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Mention suggestions"
            className="absolute bottom-full left-2 z-40 mb-2 w-72 rounded-xl border border-line bg-white p-1 shadow-pop"
          >
            {suggestions.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === mentionIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  chooseMention(p);
                }}
                className={clsx("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5", i === mentionIndex && "bg-brand-50")}
              >
                <Avatar name={p.display_name} path={p.avatar_path} userId={p.id} size="xs" />
                <span className="truncate text-sm text-ink-900">{p.display_name}</span>
                {p.title ? <span className="truncate text-xs text-ink-400">{p.title}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {files.length > 0 ? (
          <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Files to send">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex max-w-[220px] items-center gap-2 rounded-lg border border-line bg-canvas py-1 pl-2 pr-1">
                <FileIcon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink-800">{f.name}</span>
                  <span className="block text-[11px] text-ink-500">{fileSize(f.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                  className="rounded p-0.5 text-ink-400 hover:text-ink-800"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor={`${listId}-input`} className="sr-only">
          {placeholder}
        </label>
        <textarea
          id={`${listId}-input`}
          ref={textareaRef}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-describedby={hintId}
          role={showSuggestions ? "combobox" : undefined}
          aria-expanded={showSuggestions || undefined}
          aria-controls={showSuggestions ? listId : undefined}
          aria-activedescendant={showSuggestions ? `${listId}-${mentionIndex}` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            updateMentionQuery(e.target.value, e.target.selectionStart);
            if (e.target.value.trim()) onTyping?.();
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (showSuggestions) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && suggestions[mentionIndex]) {
                e.preventDefault();
                chooseMention(suggestions[mentionIndex]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionQuery(null);
                return;
              }
            }
            if (e.key === "Escape" && replyTo) onCancelReply?.();
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="block max-h-[200px] w-full resize-none border-0 bg-transparent px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-0"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            aria-label="Attach files"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
          </button>
          <EmojiPicker
            label="Insert emoji"
            align="start"
            onPick={(emoji) => insertAtCaret(emoji)}
            trigger={<Smile className="h-4 w-4" aria-hidden="true" />}
            triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          />
          <span id={hintId} className="ml-1 hidden text-[11px] text-ink-400 sm:inline">
            Enter to send · Shift+Enter for a new line · @ to mention
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim() && files.length === 0}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-ink-200 disabled:text-ink-500"
            aria-label="Send message"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
