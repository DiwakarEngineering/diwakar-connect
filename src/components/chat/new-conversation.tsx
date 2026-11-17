"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, Building2, Hash, Lock, MessagesSquare, Users, X } from "lucide-react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useSession } from "@/components/providers/session-provider";
import { Avatar } from "@/components/ui/avatar";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { Composer } from "@/components/conversation/composer";
import { sendMessageTo } from "@/components/conversation/send-message";
import type { SendInput } from "@/components/conversation/types";

type Person = RpcRow<"search_directory">;
type Conv = RpcRow<"list_my_conversations">;
type Channel = RpcRow<"list_my_channels">;
type Department = { id: string; name: string };

type Recipient = Pick<Person, "id" | "display_name" | "avatar_path" | "title" | "department_name" | "availability">;

type Suggestion =
  | { type: "person"; key: string; person: Person }
  | { type: "group"; key: string; conv: Conv }
  | { type: "channel"; key: string; channel: Channel }
  | { type: "department"; key: string; department: Department };

const MAX_RECIPIENTS = 99;

/**
 * "New chat" workspace: a To: field that searches employees, existing group
 * chats, team channels and departments. Picking one person reuses the direct
 * chat; picking several reuses a group with exactly those members, so nothing
 * is duplicated. The first message creates the conversation if needed.
 */
export function NewConversation() {
  const router = useRouter();
  const { session } = useSession();
  const { push } = useToast();
  const me = session.userId;
  const supabase = getSupabaseBrowserClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(true);
  const [groupTitle, setGroupTitle] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [addingDepartment, setAddingDepartment] = useState(false);

  // Static lists: my chats (for de-duplication and group suggestions), channels, departments.
  useEffect(() => {
    void Promise.all([
      supabase.rpc("list_my_conversations", { p_limit: 300 }),
      supabase.rpc("list_my_channels"),
      supabase.from("departments").select("id, name").order("name"),
    ]).then(([c, ch, d]) => {
      setConvs(c.data ?? []);
      setChannels((ch.data ?? []).filter((x) => !x.channel_archived && !x.team_archived));
      setDepartments(d.data ?? []);
    });
  }, [supabase]);

  // Live employee search.
  useEffect(() => {
    const q = query.trim();
    setSearching(true);
    const handle = window.setTimeout(async () => {
      const { data } = await supabase.rpc("search_directory", { p_query: q || null, p_limit: 8 });
      setPeople((data ?? []).filter((p) => p.employment_status === "active"));
      setSearching(false);
    }, q ? 180 : 0);
    return () => window.clearTimeout(handle);
  }, [query, supabase]);

  const pickedIds = useMemo(() => new Set(recipients.map((r) => r.id)), [recipients]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = query.trim().toLowerCase();
    const list: Suggestion[] = people
      .filter((p) => p.id !== me && !pickedIds.has(p.id))
      .slice(0, 6)
      .map((p) => ({ type: "person", key: `p-${p.id}`, person: p }));
    if (q && recipients.length === 0) {
      for (const c of convs.filter((c) => c.kind === "group" && c.title.toLowerCase().includes(q)).slice(0, 3)) {
        list.push({ type: "group", key: `g-${c.conversation_id}`, conv: c });
      }
      for (const ch of channels
        .filter((c) => c.channel_name.toLowerCase().includes(q) || c.team_name.toLowerCase().includes(q))
        .slice(0, 4)) {
        list.push({ type: "channel", key: `c-${ch.conversation_id}`, channel: ch });
      }
    }
    if (q) {
      for (const d of departments.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 3)) {
        list.push({ type: "department", key: `d-${d.id}`, department: d });
      }
    }
    return list;
  }, [channels, convs, departments, me, people, pickedIds, query, recipients.length]);

  useEffect(() => setActive(0), [suggestions.length, query]);

  // Is there already a conversation with exactly these people?
  const recipientKey = recipients.map((r) => r.id).sort().join(",");
  useEffect(() => {
    let cancelled = false;
    setExistingId(null);
    if (recipients.length === 0) return;
    if (recipients.length === 1) {
      const direct = convs.find((c) => c.kind === "direct" && c.other_user_id === recipients[0]!.id);
      setExistingId(direct?.conversation_id ?? null);
      return;
    }
    setChecking(true);
    void supabase.rpc("find_group_conversation", { p_member_ids: recipients.map((r) => r.id) }).then(({ data }) => {
      if (cancelled) return;
      setChecking(false);
      setExistingId(data ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recipientKey captures the member set
  }, [recipientKey, convs, supabase]);

  const addRecipient = useCallback((r: Recipient) => {
    setRecipients((list) => (list.some((x) => x.id === r.id) || list.length >= MAX_RECIPIENTS ? list : [...list, r]));
    setQuery("");
    inputRef.current?.focus();
  }, []);

  async function choose(s: Suggestion) {
    if (s.type === "person") {
      addRecipient(s.person);
    } else if (s.type === "group") {
      router.push(`/chat/${s.conv.conversation_id}`);
    } else if (s.type === "channel") {
      router.push(`/teams/${s.channel.team_id}/${s.channel.channel_id}`);
    } else {
      // A department adds its active members (reusing the existing department records).
      setAddingDepartment(true);
      const { data, error } = await supabase.rpc("search_directory", { p_department_id: s.department.id, p_limit: 100 });
      setAddingDepartment(false);
      if (error) {
        push({ tone: "error", title: "Couldn't load the department", description: friendlyError(error) });
        return;
      }
      const members = (data ?? []).filter((p) => p.employment_status === "active" && p.id !== me);
      if (members.length === 0) {
        push({ tone: "info", title: `${s.department.name} has no other active members` });
        return;
      }
      setRecipients((list) => {
        const next = [...list];
        for (const p of members) if (!next.some((x) => x.id === p.id) && next.length < MAX_RECIPIENTS) next.push(p);
        return next;
      });
      setQuery("");
      if (!groupTitle) setGroupTitle(s.department.name);
      inputRef.current?.focus();
    }
  }

  async function onSend(input: SendInput) {
    if (recipients.length === 0) throw new Error("Add at least one person in To: first.");
    let conversationId = existingId;
    if (!conversationId) {
      const result =
        recipients.length === 1
          ? await supabase.rpc("get_or_create_direct_conversation", { p_other_user: recipients[0]!.id })
          : await supabase.rpc("create_group_conversation", {
              p_member_ids: recipients.map((r) => r.id),
              p_title: groupTitle.trim() || null,
            });
      if (result.error || !result.data) throw new Error(friendlyError(result.error, "Couldn't start the chat."));
      conversationId = result.data;
    }
    await sendMessageTo(conversationId, me, input);
    router.replace(`/chat/${conversationId}`);
  }

  const showList = focused && (query.trim().length > 0 || recipients.length === 0) && (suggestions.length > 0 || searching);
  const existing = existingId ? convs.find((c) => c.conversation_id === existingId) : undefined;

  return (
    <section className="flex h-full min-h-0 flex-col bg-white" aria-label="New chat">
      <div className="flex shrink-0 items-start gap-2 border-b-2 border-brand-500 px-3 py-2 md:px-5">
        <Link
          href="/chat"
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 md:hidden"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <label htmlFor={`${listId}-to`} className="mt-2.5 shrink-0 text-sm font-semibold text-ink-700">
          To:
        </label>
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 py-1.5">
            {recipients.map((r) => (
              <span key={r.id} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-1.5 text-sm text-brand-800">
                <Avatar name={r.display_name} path={r.avatar_path} userId={r.id} size="xs" />
                <span className="truncate">{r.display_name}</span>
                <button
                  type="button"
                  onClick={() => setRecipients((list) => list.filter((x) => x.id !== r.id))}
                  className="rounded-full p-0.5 text-brand-700 hover:bg-brand-100"
                  aria-label={`Remove ${r.display_name}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            <input
              id={`${listId}-to`}
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 150)}
              placeholder={recipients.length ? "Add more people" : "Enter names, groups, channels or departments"}
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showList && suggestions[active] ? `${listId}-${active}` : undefined}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !query && recipients.length) {
                  setRecipients((list) => list.slice(0, -1));
                } else if (showList && e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(suggestions.length - 1, i + 1));
                } else if (showList && e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (showList && e.key === "Enter" && suggestions[active]) {
                  e.preventDefault();
                  void choose(suggestions[active]);
                } else if (e.key === "Escape") {
                  setFocused(false);
                }
              }}
              className="h-8 min-w-[12rem] flex-1 border-0 bg-transparent px-1 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-0"
            />
            {searching || addingDepartment ? <Spinner className="h-4 w-4 text-ink-400" /> : null}
          </div>

          {showList ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Suggestions"
              className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[22rem] overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-pop"
            >
              {suggestions.length === 0 ? (
                <li className="px-3 py-2 text-sm text-ink-500">Searching...</li>
              ) : (
                suggestions.map((s, i) => (
                  <li
                    key={s.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void choose(s);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={clsx("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2", i === active && "bg-brand-50")}
                  >
                    <SuggestionRow s={s} />
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          {checking ? (
            <Spinner className="h-5 w-5 text-ink-400" />
          ) : existingId ? (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <MessagesSquare className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <p className="text-base font-semibold text-ink-900">You already have this conversation</p>
                <p className="mt-1 text-sm text-ink-500">
                  {existing?.title ?? "This chat"} — your message will be added there, so nothing is duplicated.
                </p>
              </div>
              <Link
                href={`/chat/${existingId}`}
                className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink-800 hover:bg-ink-100"
              >
                Open conversation
              </Link>
            </>
          ) : (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                {recipients.length > 1 ? <Users className="h-6 w-6" aria-hidden="true" /> : <MessagesSquare className="h-6 w-6" aria-hidden="true" />}
              </span>
              <div>
                <p className="text-base font-semibold text-ink-900">
                  {recipients.length === 0
                    ? "You're starting a new conversation"
                    : recipients.length === 1
                      ? `New chat with ${recipients[0]!.display_name}`
                      : `New group chat with ${recipients.length} people`}
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  {recipients.length === 0
                    ? "Type a colleague's name above. Add several people to create a group."
                    : "Send a message to start the conversation."}
                </p>
              </div>
              {recipients.length > 1 ? (
                <div className="w-full max-w-sm text-left">
                  <Field label="Group name" optional hint="You can change this later.">
                    <Input value={groupTitle} maxLength={80} onChange={(e) => setGroupTitle(e.target.value)} placeholder="e.g. Bhojusar site crew" />
                  </Field>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <Composer
        placeholder="Type a message"
        disabledReason={recipients.length ? null : "Add at least one person in To: to start the conversation."}
        mentionCandidates={[]}
        maxAttachmentMb={session.settings.max_attachment_mb}
        onSend={onSend}
      />
    </section>
  );
}

function SuggestionRow({ s }: { s: Suggestion }) {
  if (s.type === "person") {
    const p = s.person;
    return (
      <>
        <Avatar name={p.display_name} path={p.avatar_path} userId={p.id} availability={p.availability} showPresence size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">{p.display_name}</span>
          <span className="block truncate text-xs text-ink-500">{[p.title, p.department_name].filter(Boolean).join(" · ") || "Employee"}</span>
        </span>
      </>
    );
  }
  const icon =
    s.type === "group" ? (
      <Users className="h-4 w-4" aria-hidden="true" />
    ) : s.type === "channel" ? (
      s.channel.channel_visibility === "private" ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Hash className="h-4 w-4" aria-hidden="true" />
    ) : (
      <Building2 className="h-4 w-4" aria-hidden="true" />
    );
  const title = s.type === "group" ? s.conv.title : s.type === "channel" ? s.channel.channel_name : s.department.name;
  const sub =
    s.type === "group"
      ? `Group chat · ${s.conv.member_count} members`
      : s.type === "channel"
        ? `Channel · ${s.channel.team_name}`
        : "Department · add everyone";
  return (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900">{title}</span>
        <span className="block truncate text-xs text-ink-500">{sub}</span>
      </span>
    </>
  );
}
