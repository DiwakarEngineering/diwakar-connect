"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { MESSAGE_PAGE_SIZE } from "@/lib/constants";
import { safeFileName } from "@/lib/storage";
import { newId } from "@/lib/uuid";
import { useSession } from "@/components/providers/session-provider";
import { MESSAGE_COLUMNS, type Attachment, type Message, type Reaction, type SendInput } from "./types";

export type MessageStore = {
  messages: Map<string, Message>;
  /** Ids shown in the main stream, oldest first. */
  timeline: string[];
  reactions: Map<string, Reaction[]>;
  attachments: Map<string, Attachment[]>;
  replyCounts: Map<string, number>;
};

const emptyStore = (): MessageStore => ({
  messages: new Map(),
  timeline: [],
  reactions: new Map(),
  attachments: new Map(),
  replyCounts: new Map(),
});

function byTime(a: Message, b: Message) {
  return a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at);
}

function insertSorted(timeline: string[], messages: Map<string, Message>, id: string) {
  if (timeline.includes(id)) return timeline;
  const msg = messages.get(id);
  if (!msg) return timeline;
  const next = [...timeline];
  let i = next.length;
  while (i > 0) {
    const prev = messages.get(next[i - 1]!);
    if (!prev || byTime(prev, msg) <= 0) break;
    i--;
  }
  next.splice(i, 0, id);
  return next;
}

/**
 * Message store for one conversation: cursor-paginated history, Realtime
 * updates, and optimistic send/edit/delete/react with rollback on failure.
 */
export function useMessages(conversationId: string, clearedAt: string | null = null) {
  const supabase = getSupabaseBrowserClient();
  // Hide messages the person removed with "Clear chat history" (they stay in the database).
  const after = clearedAt ?? "-infinity";
  const { session } = useSession();
  const me = session.userId;
  const [store, setStore] = useState<MessageStore>(emptyStore);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const storeRef = useRef(store);
  const failedInputs = useRef(new Map<string, SendInput>());

  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  const hydrate = useCallback(
    async (msgs: Message[]) => {
      const ids = msgs.map((m) => m.id);
      if (ids.length === 0) return;
      const known = storeRef.current.messages;
      const missingParents = Array.from(
        new Set(msgs.map((m) => m.reply_to_id).filter((id): id is string => !!id && !known.has(id) && !ids.includes(id))),
      );
      const [reactions, attachments, replies, parents] = await Promise.all([
        supabase.from("message_reactions").select("*").in("message_id", ids),
        supabase.from("attachments").select("*").in("message_id", ids),
        supabase.from("messages").select("reply_to_id").in("reply_to_id", ids).is("deleted_at", null),
        missingParents.length
          ? supabase.from("messages").select(MESSAGE_COLUMNS).in("id", missingParents)
          : Promise.resolve({ data: [] as Message[] }),
      ]);
      setStore((s) => {
        const next: MessageStore = {
          ...s,
          messages: new Map(s.messages),
          reactions: new Map(s.reactions),
          attachments: new Map(s.attachments),
          replyCounts: new Map(s.replyCounts),
        };
        for (const id of ids) {
          next.reactions.set(id, []);
          next.attachments.set(id, []);
          next.replyCounts.set(id, 0);
        }
        for (const r of reactions.data ?? []) next.reactions.get(r.message_id)?.push(r);
        for (const a of attachments.data ?? []) next.attachments.get(a.message_id)?.push(a);
        for (const r of replies.data ?? []) {
          if (r.reply_to_id) next.replyCounts.set(r.reply_to_id, (next.replyCounts.get(r.reply_to_id) ?? 0) + 1);
        }
        for (const p of parents.data ?? []) if (!next.messages.has(p.id)) next.messages.set(p.id, p);
        return next;
      });
    },
    [supabase],
  );

  const addMessages = useCallback((msgs: Message[], toTimeline: boolean) => {
    setStore((s) => {
      const messages = new Map(s.messages);
      for (const m of msgs) messages.set(m.id, { ...messages.get(m.id), ...m, pending: false, failed: false });
      let timeline = s.timeline;
      if (toTimeline) {
        const ids = new Set(timeline);
        for (const m of msgs) ids.add(m.id);
        timeline = Array.from(ids)
          .map((id) => messages.get(id)!)
          .filter(Boolean)
          .sort(byTime)
          .map((m) => m.id);
      }
      return { ...s, messages, timeline };
    });
  }, []);

  const loadLatest = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .gt("created_at", after)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE);
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load messages."));
      setStatus("error");
      return;
    }
    const msgs = (data ?? []).reverse();
    addMessages(msgs, true);
    setHasMore((data ?? []).length === MESSAGE_PAGE_SIZE);
    setStatus("ready");
    setError(null);
    await hydrate(msgs);
  }, [addMessages, after, conversationId, hydrate, supabase]);

  const loadOlder = useCallback(async () => {
    const s = storeRef.current;
    const oldest = s.timeline.length ? s.messages.get(s.timeline[0]!) : undefined;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const { data, error: loadError } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .gt("created_at", after)
      .or(`created_at.lt."${oldest.created_at}",and(created_at.eq."${oldest.created_at}",id.lt.${oldest.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE);
    setLoadingOlder(false);
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load older messages."));
      return;
    }
    const msgs = (data ?? []).reverse();
    addMessages(msgs, true);
    setHasMore((data ?? []).length === MESSAGE_PAGE_SIZE);
    await hydrate(msgs);
  }, [addMessages, after, conversationId, hydrate, loadingOlder, supabase]);

  const loadThread = useCallback(
    async (rootId: string) => {
      const [root, replies] = await Promise.all([
        storeRef.current.messages.has(rootId)
          ? Promise.resolve({ data: [] as Message[], error: null })
          : supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", rootId),
        supabase
          .from("messages")
          .select(MESSAGE_COLUMNS)
          .eq("reply_to_id", rootId)
          .gt("created_at", after)
          .order("created_at", { ascending: true })
          .limit(200),
      ]);
      if (replies.error) throw new Error(friendlyError(replies.error, "Couldn't load the thread."));
      const msgs = [...(root.data ?? []), ...(replies.data ?? [])];
      addMessages(msgs, false);
      await hydrate(msgs);
    },
    [addMessages, after, hydrate, supabase],
  );

  // Initial load + Realtime subscription.
  useEffect(() => {
    setStore(emptyStore());
    setStatus("loading");
    setHasMore(false);
    void loadLatest();

    let wasDisconnected = false;
    const channel = supabase
      .channel(`conv-db:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = payload.new as Message;
          const clean: Message = { ...m };
          delete (clean as Partial<Message> & { search?: unknown }).search;
          const isNew = !storeRef.current.messages.has(m.id);
          addMessages([clean], true);
          setStore((s) => {
            const next = { ...s };
            if (!next.reactions.has(m.id)) next.reactions = new Map(s.reactions).set(m.id, []);
            if (!next.attachments.has(m.id)) next.attachments = new Map(next.attachments).set(m.id, []);
            if (isNew && m.reply_to_id) {
              next.replyCounts = new Map(s.replyCounts).set(m.reply_to_id, (s.replyCounts.get(m.reply_to_id) ?? 0) + 1);
            }
            return next;
          });
          if (m.reply_to_id && !storeRef.current.messages.has(m.reply_to_id)) void hydrate([clean]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = payload.new as Message;
          setStore((s) => {
            const prev = s.messages.get(m.id);
            if (!prev) return s;
            const messages = new Map(s.messages).set(m.id, {
              ...prev,
              body: m.body,
              mentions: m.mentions,
              edited_at: m.edited_at,
              deleted_at: m.deleted_at,
              deleted_by: m.deleted_by,
            });
            const next = { ...s, messages };
            if (m.deleted_at && !prev.deleted_at) {
              next.reactions = new Map(s.reactions).set(m.id, []);
              next.attachments = new Map(s.attachments).set(m.id, []);
              if (m.reply_to_id) {
                next.replyCounts = new Map(s.replyCounts).set(
                  m.reply_to_id,
                  Math.max(0, (s.replyCounts.get(m.reply_to_id) ?? 1) - 1),
                );
              }
            }
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "attachments", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const a = payload.new as Attachment;
          setStore((s) => {
            const list = s.attachments.get(a.message_id) ?? [];
            if (list.some((x) => x.id === a.id)) return s;
            return { ...s, attachments: new Map(s.attachments).set(a.message_id, [...list, a]) };
          });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
        const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Partial<Reaction>;
        if (!row.message_id || !storeRef.current.messages.has(row.message_id)) return;
        setStore((s) => {
          const list = s.reactions.get(row.message_id!) ?? [];
          const same = (r: Reaction) => r.user_id === row.user_id && r.emoji === row.emoji;
          const nextList =
            payload.eventType === "DELETE"
              ? list.filter((r) => !same(r))
              : list.some(same)
                ? list
                : [...list, row as Reaction];
          return { ...s, reactions: new Map(s.reactions).set(row.message_id!, nextList) };
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") wasDisconnected = true;
        // After a reconnect, refetch the latest page to fill any gap.
        if (status === "SUBSCRIBED" && wasDisconnected) {
          wasDisconnected = false;
          void loadLatest();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [addMessages, conversationId, hydrate, loadLatest, supabase]);

  const send = useCallback(
    async (input: SendInput) => {
      const id = newId();
      const optimistic: Message = {
        id,
        conversation_id: conversationId,
        sender_id: me,
        kind: "user",
        body: input.body,
        reply_to_id: input.replyToId,
        mentions: input.mentions,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        deleted_by: null,
        pending: true,
      };
      const adjustReplyCount = (delta: number) => {
        const parent = input.replyToId;
        if (!parent) return;
        setStore((s) => ({
          ...s,
          replyCounts: new Map(s.replyCounts).set(parent, Math.max(0, (s.replyCounts.get(parent) ?? 0) + delta)),
        }));
      };
      setStore((s) => {
        const messages = new Map(s.messages).set(id, optimistic);
        return {
          ...s,
          messages,
          timeline: insertSorted(s.timeline, messages, id),
          reactions: new Map(s.reactions).set(id, []),
          attachments: new Map(s.attachments).set(id, []),
        };
      });
      adjustReplyCount(1);

      const uploaded: { path: string; file: File }[] = [];
      let messageCreated = false;
      try {
        for (const file of input.files) {
          const path = `${conversationId}/${me}/${newId()}-${safeFileName(file.name)}`;
          const { error: uploadError } = await supabase.storage
            .from("attachments")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (uploadError) throw new Error(`"${file.name}" couldn't be uploaded. ${friendlyError(uploadError, "")}`.trim());
          uploaded.push({ path, file });
        }

        const { error: insertError } = await supabase.from("messages").insert({
          id,
          conversation_id: conversationId,
          sender_id: me,
          body: input.body,
          reply_to_id: input.replyToId,
          mentions: input.mentions,
        });
        if (insertError) throw new Error(friendlyError(insertError, "Message not sent."));
        messageCreated = true;

        if (uploaded.length) {
          const { error: attachError } = await supabase.from("attachments").insert(
            uploaded.map(({ path, file }) => ({
              message_id: id,
              conversation_id: conversationId,
              uploader_id: me,
              object_path: path,
              file_name: file.name.slice(0, 255),
              mime_type: file.type || "application/octet-stream",
              size_bytes: file.size,
            })),
          );
          if (attachError) {
            await supabase.storage.from("attachments").remove(uploaded.map((u) => u.path));
            if (!input.body.trim()) await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", id);
            throw new Error(friendlyError(attachError, "Files couldn't be attached."));
          }
          const { data: rows } = await supabase.from("attachments").select("*").eq("message_id", id);
          setStore((s) => ({ ...s, attachments: new Map(s.attachments).set(id, rows ?? []) }));
        }

        setStore((s) => {
          const m = s.messages.get(id);
          if (!m) return s;
          return { ...s, messages: new Map(s.messages).set(id, { ...m, pending: false }) };
        });
      } catch (e) {
        if (uploaded.length) void supabase.storage.from("attachments").remove(uploaded.map((u) => u.path));
        if (messageCreated) {
          // The text was delivered; only the files failed. Don't offer a duplicate resend.
          if (input.body.trim()) {
            setStore((s) => {
              const m = s.messages.get(id);
              return m ? { ...s, messages: new Map(s.messages).set(id, { ...m, pending: false }) } : s;
            });
          } else {
            setStore((s) => {
              const messages = new Map(s.messages);
              messages.delete(id);
              return { ...s, messages, timeline: s.timeline.filter((x) => x !== id) };
            });
          }
          throw e;
        }
        adjustReplyCount(-1);
        failedInputs.current.set(id, input);
        setStore((s) => {
          const m = s.messages.get(id);
          if (!m) return s;
          return { ...s, messages: new Map(s.messages).set(id, { ...m, pending: false, failed: true }) };
        });
        throw e;
      }
    },
    [conversationId, me, supabase],
  );

  const discardFailed = useCallback((id: string) => {
    failedInputs.current.delete(id);
    setStore((s) => {
      const messages = new Map(s.messages);
      messages.delete(id);
      return { ...s, messages, timeline: s.timeline.filter((x) => x !== id) };
    });
  }, []);

  const retryFailed = useCallback(
    async (id: string) => {
      const input = failedInputs.current.get(id);
      if (!input) return;
      discardFailed(id);
      await send(input);
    },
    [discardFailed, send],
  );

  const edit = useCallback(
    async (id: string, body: string, mentions: string[]) => {
      const prev = storeRef.current.messages.get(id);
      if (!prev) return;
      setStore((s) => ({
        ...s,
        messages: new Map(s.messages).set(id, { ...prev, body, mentions, edited_at: new Date().toISOString() }),
      }));
      const { error: editError } = await supabase.from("messages").update({ body, mentions }).eq("id", id);
      if (editError) {
        setStore((s) => ({ ...s, messages: new Map(s.messages).set(id, prev) }));
        throw new Error(friendlyError(editError, "Couldn't edit the message."));
      }
    },
    [supabase],
  );

  const remove = useCallback(
    async (id: string) => {
      const prev = storeRef.current.messages.get(id);
      if (!prev) return;
      const ownFiles = (storeRef.current.attachments.get(id) ?? [])
        .filter((a) => a.uploader_id === me)
        .map((a) => a.object_path);
      setStore((s) => ({
        ...s,
        messages: new Map(s.messages).set(id, { ...prev, body: "", deleted_at: new Date().toISOString() }),
      }));
      const { error: deleteError } = await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (deleteError) {
        setStore((s) => ({ ...s, messages: new Map(s.messages).set(id, prev) }));
        throw new Error(friendlyError(deleteError, "Couldn't delete the message."));
      }
      setStore((s) => ({
        ...s,
        attachments: new Map(s.attachments).set(id, []),
        reactions: new Map(s.reactions).set(id, []),
      }));
      if (ownFiles.length) await supabase.storage.from("attachments").remove(ownFiles);
    },
    [me, supabase],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const list = storeRef.current.reactions.get(messageId) ?? [];
      const mine = list.find((r) => r.user_id === me && r.emoji === emoji);
      const optimistic = mine
        ? list.filter((r) => r !== mine)
        : [...list, { message_id: messageId, user_id: me, emoji, created_at: new Date().toISOString() }];
      setStore((s) => ({ ...s, reactions: new Map(s.reactions).set(messageId, optimistic) }));
      const { error: reactError } = mine
        ? await supabase.from("message_reactions").delete().match({ message_id: messageId, user_id: me, emoji })
        : await supabase.from("message_reactions").insert({ message_id: messageId, user_id: me, emoji });
      if (reactError) {
        setStore((s) => ({ ...s, reactions: new Map(s.reactions).set(messageId, list) }));
        throw new Error(friendlyError(reactError, "Couldn't update the reaction."));
      }
    },
    [me, supabase],
  );

  return {
    store,
    status,
    error,
    hasMore,
    loadingOlder,
    reload: loadLatest,
    loadOlder,
    loadThread,
    send,
    retryFailed,
    discardFailed,
    edit,
    remove,
    toggleReaction,
  };
}

export type MessagesApi = ReturnType<typeof useMessages>;
