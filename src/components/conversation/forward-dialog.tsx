"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Hash, Search, Users } from "lucide-react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { getSignedUrl, safeFileName } from "@/lib/storage";
import { newId } from "@/lib/uuid";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Sticker } from "./stickers";
import type { Attachment, Message } from "./types";

type Row = RpcRow<"list_my_conversations">;
const MAX_TARGETS = 5;

/**
 * Forward a message to up to five chats or channels. Files are copied into the
 * target conversation's storage folder, so the target's own access rules apply.
 */
export function ForwardDialog({
  message,
  attachments,
  onClose,
}: {
  message: Message | null;
  attachments: Attachment[];
  onClose: () => void;
}) {
  const { session } = useSession();
  const { push } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = message !== null;

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setQuery("");
    setError(null);
    setRows(null);
    void getSupabaseBrowserClient()
      .rpc("list_my_conversations", { p_limit: 300 })
      .then(({ data, error: e }) => {
        if (e) setError(friendlyError(e, "Couldn't load your chats."));
        setRows(data ?? []);
      });
  }, [open]);

  const people = usePeopleById((rows ?? []).map((r) => r.other_user_id));
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) => !q || r.title.toLowerCase().includes(q) || (r.team_name ?? "").toLowerCase().includes(q),
    );
  }, [query, rows]);

  async function forward() {
    if (!message || picked.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const failed: string[] = [];
    for (const conversationId of picked) {
      const uploaded: { path: string; a: Attachment }[] = [];
      try {
        for (const a of attachments) {
          const url = await getSignedUrl("attachments", a.object_path, 300);
          if (!url) throw new Error(`"${a.file_name}" is no longer available.`);
          const blob = await (await fetch(url)).blob();
          const path = `${conversationId}/${session.userId}/${newId()}-${safeFileName(a.file_name)}`;
          const { error: upErr } = await supabase.storage
            .from("attachments")
            .upload(path, blob, { contentType: a.mime_type, upsert: false });
          if (upErr) throw new Error(friendlyError(upErr, `"${a.file_name}" couldn't be copied.`));
          uploaded.push({ path, a });
        }
        const id = newId();
        const { error: msgErr } = await supabase.from("messages").insert({
          id,
          conversation_id: conversationId,
          sender_id: session.userId,
          body: message.body,
          sticker: message.sticker,
          forwarded_from_id: message.id,
        });
        if (msgErr) throw new Error(friendlyError(msgErr, "Not forwarded."));
        if (uploaded.length) {
          const { error: attErr } = await supabase.from("attachments").insert(
            uploaded.map(({ path, a }) => ({
              message_id: id,
              conversation_id: conversationId,
              uploader_id: session.userId,
              object_path: path,
              file_name: a.file_name,
              mime_type: a.mime_type,
              size_bytes: a.size_bytes,
            })),
          );
          if (attErr) throw new Error(friendlyError(attErr, "Files couldn't be attached."));
        }
      } catch (e) {
        if (uploaded.length) void supabase.storage.from("attachments").remove(uploaded.map((u) => u.path));
        const title = rows?.find((r) => r.conversation_id === conversationId)?.title ?? "a chat";
        failed.push(`${title}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setBusy(false);
    if (failed.length) {
      setError(`Not forwarded to ${failed.join("; ")}`);
      return;
    }
    push({ tone: "success", title: picked.length === 1 ? "Message forwarded" : `Forwarded to ${picked.length} chats` });
    onClose();
  }

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TARGETS ? p : [...p, id]));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Forward message"
      description={`Choose up to ${MAX_TARGETS} chats or channels.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void forward()} loading={busy} disabled={picked.length === 0}>
            {picked.length > 1 ? `Forward to ${picked.length}` : "Forward"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        {message ? (
          <div className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink-700">
            {message.sticker ? <Sticker id={message.sticker} size="sm" /> : null}
            {message.body ? <p className="line-clamp-3 whitespace-pre-wrap">{message.body}</p> : null}
            {attachments.length ? (
              <p className="mt-1 text-xs text-ink-500">
                {attachments.length} {attachments.length === 1 ? "file" : "files"}: {attachments.map((a) => a.file_name).join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats and channels"
            aria-label="Search chats and channels"
            className="h-9 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm placeholder:text-ink-400 focus:bg-white"
          />
        </div>
        <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-xl border border-line">
          {rows === null ? (
            <SkeletonRows rows={5} />
          ) : visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">No chats match.</p>
          ) : (
            <ul aria-label="Forward to">
              {visible.map((r) => {
                const selected = picked.includes(r.conversation_id);
                const other = r.other_user_id ? people.get(r.other_user_id) : undefined;
                return (
                  <li key={r.conversation_id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      onClick={() => toggle(r.conversation_id)}
                      disabled={!selected && picked.length >= MAX_TARGETS}
                      className={clsx(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors disabled:opacity-50",
                        selected ? "bg-brand-50" : "hover:bg-canvas",
                      )}
                    >
                      {r.kind === "direct" ? (
                        <Avatar name={r.title} path={other?.avatar_path} userId={r.other_user_id ?? undefined} size="sm" />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                          {r.kind === "channel" ? <Hash className="h-4 w-4" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-900">{r.title}</span>
                        {r.team_name ? <span className="block truncate text-xs text-ink-500">{r.team_name}</span> : null}
                      </span>
                      <span
                        className={clsx(
                          "flex h-5 w-5 items-center justify-center rounded-md border",
                          selected ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300",
                        )}
                        aria-hidden="true"
                      >
                        {selected ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
