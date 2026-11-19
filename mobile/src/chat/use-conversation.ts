import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { File as FsFile } from "expo-file-system";
import type { Tables } from "@/lib/database.types";
import { friendlyError, supabase } from "@/lib/supabase";
import { newId, safeFileName } from "@/lib/storage";

export type Message = Omit<Tables<"messages">, "search"> & { pending?: boolean; failed?: boolean };
export type Reaction = Tables<"message_reactions">;
export type Attachment = Tables<"attachments">;
export type LocalFile = { uri: string; name: string; mimeType: string; size: number };
export type SendInput = { body: string; mentions: string[]; replyToId: string | null; files: LocalFile[]; sticker?: string | null };

const BASE = "id, conversation_id, sender_id, kind, body, reply_to_id, mentions, created_at, edited_at, deleted_at, deleted_by";
const UPGRADED = `${BASE}, pinned_at, pinned_by, forwarded_from_id, sticker`;
const PAGE = 40;
// Set once we know whether the chat-workspace migration is applied.
let columns: string | null = null;

async function selectMessages<T>(build: (cols: string) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>) {
  const first = await build(columns ?? UPGRADED);
  if (first.error?.code === "42703" && columns !== BASE) {
    columns = BASE;
    return build(BASE);
  }
  if (!first.error && !columns) columns = UPGRADED;
  return first;
}

export type Meta = {
  id: string;
  kind: Tables<"conversations">["kind"];
  title: string;
  otherUserId: string | null;
  memberIds: string[];
  canPost: boolean;
  clearedAt: string | null;
  channelName: string | null;
  teamName: string | null;
};

/** Conversation header data: kind, members, posting rights (the database is authoritative). */
export function useMeta(conversationId: string, me: string) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data: c, error: e } = await supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle();
    if (e) return setError(friendlyError(e));
    if (!c) return setError("This conversation isn't available. It may have been removed, or you're not a member.");
    const [{ data: canPost }, { data: st }] = await Promise.all([
      supabase.rpc("can_post_to_conversation", { p_conversation: conversationId }),
      supabase.from("conversation_user_state").select("cleared_at").eq("conversation_id", conversationId).eq("user_id", me).maybeSingle(),
    ]);
    let memberIds: string[] = [];
    let channelName: string | null = null;
    let teamName: string | null = null;
    if (c.kind === "channel" && c.channel_id) {
      const { data: ch } = await supabase.from("channels").select("*").eq("id", c.channel_id).maybeSingle();
      if (ch) {
        channelName = ch.name;
        const [{ data: t }, members] = await Promise.all([
          supabase.from("teams").select("name").eq("id", ch.team_id).maybeSingle(),
          ch.visibility === "private"
            ? supabase.from("channel_members").select("user_id").eq("channel_id", ch.id)
            : supabase.from("team_members").select("user_id").eq("team_id", ch.team_id),
        ]);
        teamName = t?.name ?? null;
        memberIds = (members.data ?? []).map((m) => m.user_id);
      }
    } else {
      const { data: m } = await supabase.from("conversation_members").select("user_id, left_at").eq("conversation_id", conversationId);
      memberIds = (m ?? []).filter((x) => !x.left_at).map((x) => x.user_id);
    }
    setError(null);
    setMeta({
      id: c.id,
      kind: c.kind,
      title: c.title ?? "",
      otherUserId: c.kind === "direct" ? (memberIds.find((id) => id !== me) ?? me) : null,
      memberIds,
      canPost: !!canPost,
      clearedAt: (st as { cleared_at?: string | null } | null)?.cleared_at ?? null,
      channelName,
      teamName,
    });
  }, [conversationId, me]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set when the request resolves
    void load();
  }, [load]);
  return { meta, error, reload: load };
}

/** Messages with live updates, optimistic sending, uploads, edits, deletes and reactions. */
export function useMessages(conversationId: string, me: string, clearedAt: string | null) {
  const [messages, setMessages] = useState<Map<string, Message>>(new Map());
  const [reactions, setReactions] = useState<Map<string, Reaction[]>>(new Map());
  const [attachments, setAttachments] = useState<Map<string, Attachment[]>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const failed = useRef(new Map<string, SendInput>());
  const ref = useRef(messages);
  useEffect(() => {
    ref.current = messages;
  }, [messages]);
  const after = clearedAt ?? "-infinity";

  const hydrate = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const [r, a] = await Promise.all([
      supabase.from("message_reactions").select("*").in("message_id", ids),
      supabase.from("attachments").select("*").in("message_id", ids),
    ]);
    setReactions((m) => {
      const next = new Map(m);
      for (const id of ids) next.set(id, []);
      for (const x of r.data ?? []) next.get(x.message_id)?.push(x);
      return next;
    });
    setAttachments((m) => {
      const next = new Map(m);
      for (const id of ids) next.set(id, []);
      for (const x of a.data ?? []) next.get(x.message_id)?.push(x);
      return next;
    });
  }, []);

  const add = useCallback((list: Message[]) => {
    setMessages((m) => {
      const next = new Map(m);
      for (const x of list) next.set(x.id, { ...next.get(x.id), ...x, pending: false, failed: false });
      return next;
    });
  }, []);

  const loadLatest = useCallback(async () => {
    const { data, error: e } = await selectMessages<Message[]>((cols) =>
      supabase
        .from("messages")
        .select(cols)
        .eq("conversation_id", conversationId)
        .gt("created_at", after)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE) as unknown as PromiseLike<{ data: Message[] | null; error: { code?: string; message: string } | null }>,
    );
    if (e) {
      setError(friendlyError(e, "Couldn't load messages."));
      setStatus("error");
      return;
    }
    add(data ?? []);
    setHasMore((data ?? []).length === PAGE);
    setStatus("ready");
    await hydrate((data ?? []).map((m) => m.id));
  }, [add, after, conversationId, hydrate]);

  const loadOlder = useCallback(async () => {
    const list = Array.from(ref.current.values()).filter((m) => !m.pending).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const oldest = list[0];
    if (!oldest || !hasMore) return;
    const { data } = await selectMessages<Message[]>((cols) =>
      supabase
        .from("messages")
        .select(cols)
        .eq("conversation_id", conversationId)
        .gt("created_at", after)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(PAGE) as unknown as PromiseLike<{ data: Message[] | null; error: { code?: string; message: string } | null }>,
    );
    add(data ?? []);
    setHasMore((data ?? []).length === PAGE);
    await hydrate((data ?? []).map((m) => m.id));
  }, [add, after, conversationId, hasMore, hydrate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set when the request resolves
    void loadLatest();
    let lost = false;
    const channel = supabase
      .channel(`m-conv:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (p) => {
        const m = { ...(p.new as Message) };
        delete (m as { search?: unknown }).search;
        add([m]);
        setReactions((r) => (r.has(m.id) ? r : new Map(r).set(m.id, [])));
        setAttachments((a) => (a.has(m.id) ? a : new Map(a).set(m.id, [])));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (p) => {
        const m = p.new as Message;
        setMessages((map) => {
          const prev = map.get(m.id);
          if (!prev) return map;
          return new Map(map).set(m.id, { ...prev, body: m.body, mentions: m.mentions, edited_at: m.edited_at, deleted_at: m.deleted_at, deleted_by: m.deleted_by, pinned_at: m.pinned_at ?? null, pinned_by: m.pinned_by ?? null });
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "attachments", filter: `conversation_id=eq.${conversationId}` }, (p) => {
        const a = p.new as Attachment;
        setAttachments((map) => {
          const list = map.get(a.message_id) ?? [];
          return list.some((x) => x.id === a.id) ? map : new Map(map).set(a.message_id, [...list, a]);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as Partial<Reaction>;
        if (!row.message_id || !ref.current.has(row.message_id)) return;
        setReactions((map) => {
          const list = map.get(row.message_id!) ?? [];
          const same = (x: Reaction) => x.user_id === row.user_id && x.emoji === row.emoji;
          const next = p.eventType === "DELETE" ? list.filter((x) => !same(x)) : list.some(same) ? list : [...list, row as Reaction];
          return new Map(map).set(row.message_id!, next);
        });
      })
      .subscribe((s) => {
        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") lost = true;
        if (s === "SUBSCRIBED" && lost) {
          lost = false;
          void loadLatest(); // fill the gap after a reconnect
        }
      });
    // Coming back from the background: catch up.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void loadLatest());
    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [add, conversationId, loadLatest]);

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
        pinned_at: null,
        pinned_by: null,
        forwarded_from_id: null,
        sticker: input.sticker ?? null,
        pending: true,
      };
      setMessages((m) => new Map(m).set(id, optimistic));
      const uploaded: { path: string; f: LocalFile }[] = [];
      try {
        for (const f of input.files) {
          const path = `${conversationId}/${me}/${newId()}-${safeFileName(f.name)}`;
          const bytes = await new FsFile(f.uri).arrayBuffer();
          const { error: e } = await supabase.storage.from("attachments").upload(path, bytes, { contentType: f.mimeType, upsert: false });
          if (e) throw new Error(`"${f.name}" couldn't be uploaded. ${friendlyError(e, "")}`.trim());
          uploaded.push({ path, f });
        }
        const row: Record<string, unknown> = { id, conversation_id: conversationId, sender_id: me, body: input.body, reply_to_id: input.replyToId, mentions: input.mentions };
        if (input.sticker) row.sticker = input.sticker;
        const { error: e } = await supabase.from("messages").insert(row as never);
        if (e) throw new Error(friendlyError(e, "Message not sent."));
        if (uploaded.length) {
          const { error: ae } = await supabase.from("attachments").insert(
            uploaded.map(({ path, f }) => ({
              message_id: id,
              conversation_id: conversationId,
              uploader_id: me,
              object_path: path,
              file_name: f.name.slice(0, 255),
              mime_type: f.mimeType,
              size_bytes: f.size,
            })),
          );
          if (ae) throw new Error(friendlyError(ae, "Files couldn't be attached."));
          const { data: rows } = await supabase.from("attachments").select("*").eq("message_id", id);
          setAttachments((m) => new Map(m).set(id, rows ?? []));
        }
        setMessages((m) => (m.has(id) ? new Map(m).set(id, { ...m.get(id)!, pending: false }) : m));
      } catch (err) {
        if (uploaded.length) void supabase.storage.from("attachments").remove(uploaded.map((u) => u.path));
        failed.current.set(id, input);
        setMessages((m) => (m.has(id) ? new Map(m).set(id, { ...m.get(id)!, pending: false, failed: true }) : m));
        throw err;
      }
    },
    [conversationId, me],
  );

  const discard = useCallback((id: string) => {
    failed.current.delete(id);
    setMessages((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);

  const retry = useCallback(
    async (id: string) => {
      const input = failed.current.get(id);
      if (!input) return;
      discard(id);
      await send(input);
    },
    [discard, send],
  );

  const edit = useCallback(async (id: string, body: string) => {
    const { error: e } = await supabase.from("messages").update({ body }).eq("id", id);
    if (e) throw new Error(friendlyError(e, "Couldn't edit the message."));
    setMessages((m) => (m.has(id) ? new Map(m).set(id, { ...m.get(id)!, body, edited_at: new Date().toISOString() }) : m));
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error: e } = await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (e) throw new Error(friendlyError(e, "Couldn't delete the message."));
    setMessages((m) => (m.has(id) ? new Map(m).set(id, { ...m.get(id)!, body: "", deleted_at: new Date().toISOString() }) : m));
  }, []);

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      const list = reactions.get(messageId) ?? [];
      const mine = list.find((r) => r.user_id === me && r.emoji === emoji);
      setReactions((m) =>
        new Map(m).set(messageId, mine ? list.filter((r) => r !== mine) : [...list, { message_id: messageId, user_id: me, emoji, created_at: new Date().toISOString() }]),
      );
      const { error: e } = mine
        ? await supabase.from("message_reactions").delete().match({ message_id: messageId, user_id: me, emoji })
        : await supabase.from("message_reactions").insert({ message_id: messageId, user_id: me, emoji });
      if (e) {
        setReactions((m) => new Map(m).set(messageId, list));
        throw new Error(friendlyError(e, "Couldn't update the reaction."));
      }
    },
    [me, reactions],
  );

  const pin = useCallback(async (id: string, pinned: boolean) => {
    const { error: e } = await supabase.rpc("pin_message", { p_message_id: id, p_pinned: pinned });
    if (e) throw new Error(/pin_message/.test(e.message) ? "Pinning needs the latest server update." : friendlyError(e));
    setMessages((m) => (m.has(id) ? new Map(m).set(id, { ...m.get(id)!, pinned_at: pinned ? new Date().toISOString() : null }) : m));
  }, []);

  /** Newest first (the list is inverted). */
  const ordered = useMemo(
    () => Array.from(messages.values()).sort((a, b) => (a.created_at === b.created_at ? b.id.localeCompare(a.id) : b.created_at.localeCompare(a.created_at))),
    [messages],
  );

  return { ordered, messages, reactions, attachments, status, error, hasMore, loadOlder, reload: loadLatest, send, retry, discard, edit, remove, react, pin, supportsUpgrade: () => columns === UPGRADED };
}

/** Typing indicators: the same private broadcast topic as the website. */
export function useTyping(conversationId: string, me: string) {
  const [typing, setTyping] = useState<Record<string, number>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const last = useRef(0);
  useEffect(() => {
    const channel = supabase.channel(`conversation:${conversationId}`, { config: { private: true, broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const from = (payload as { userId?: string }).userId;
        if (from && from !== me) setTyping((t) => ({ ...t, [from]: Date.now() }));
      })
      .on("broadcast", { event: "stopped" }, ({ payload }) => {
        const from = (payload as { userId?: string }).userId;
        if (!from) return;
        setTyping((t) => {
          const next = { ...t };
          delete next[from];
          return next;
        });
      })
      .subscribe();
    channelRef.current = channel;
    const sweep = setInterval(() => {
      setTyping((t) => {
        const now = Date.now();
        const kept = Object.entries(t).filter(([, at]) => now - at < 4500);
        return kept.length === Object.keys(t).length ? t : Object.fromEntries(kept);
      });
    }, 1000);
    return () => {
      clearInterval(sweep);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, me]);
  const notifyTyping = useCallback(() => {
    if (Date.now() - last.current < 2500) return;
    last.current = Date.now();
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: me } });
  }, [me]);
  const notifyStopped = useCallback(() => {
    last.current = 0;
    void channelRef.current?.send({ type: "broadcast", event: "stopped", payload: { userId: me } });
  }, [me]);
  return { typingIds: Object.keys(typing), notifyTyping, notifyStopped };
}
