"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Hash, MessageSquare, Search, Users } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import type { RpcRow } from "@/lib/database.types";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

type Result =
  | { type: "person"; id: string; label: string; sub: string | null; person: RpcRow<"search_directory"> }
  | { type: "conversation"; id: string; label: string; sub: string | null; kind: "direct" | "group" | "channel"; href: string };

/**
 * Combobox search for people and conversations. Choosing a person opens (or
 * creates) the direct chat with them.
 */
export function GlobalSearch({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const handle = window.setTimeout(async () => {
      const [people, convs, channels] = await Promise.all([
        supabase.rpc("search_directory", { p_query: q, p_limit: 6 }),
        supabase.rpc("list_my_conversations", { p_search: q, p_limit: 5 }),
        supabase.rpc("list_my_channels"),
      ]);
      const lower = q.toLowerCase();
      const next: Result[] = [
        ...(people.data ?? []).map((p) => ({
          type: "person" as const,
          id: p.id,
          label: p.display_name,
          sub: [p.title, p.department_name].filter(Boolean).join(" · ") || null,
          person: p,
        })),
        ...(convs.data ?? [])
          .filter((c) => c.kind === "group")
          .map((c) => ({
            type: "conversation" as const,
            id: c.conversation_id,
            label: c.title,
            sub: `${c.member_count} members`,
            kind: c.kind,
            href: `/chat/${c.conversation_id}`,
          })),
        ...(channels.data ?? [])
          .filter((c) => c.channel_name.toLowerCase().includes(lower) || c.team_name.toLowerCase().includes(lower))
          .slice(0, 5)
          .map((c) => ({
            type: "conversation" as const,
            id: c.conversation_id,
            label: `${c.channel_name}`,
            sub: c.team_name,
            kind: "channel" as const,
            href: `/teams/${c.team_id}/${c.channel_id}`,
          })),
      ];
      setResults(next);
      setActive(0);
      setLoading(false);
      setOpen(true);
    }, 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function choose(result: Result) {
    setOpen(false);
    setQuery("");
    onDone?.();
    if (result.type === "conversation") {
      router.push(result.href);
      return;
    }
    const { data, error } = await getSupabaseBrowserClient().rpc("get_or_create_direct_conversation", {
      p_other_user: result.id,
    });
    if (error || !data) {
      push({ tone: "error", title: "Couldn't open chat", description: friendlyError(error) });
      return;
    }
    router.push(`/chat/${data}`);
  }

  const showList = open && query.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
      <input
        type="search"
        role="combobox"
        aria-label="Search people, chats and channels"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            void choose(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search people, chats, channels"
        className="h-10 w-full rounded-xl border border-line bg-canvas pl-9 pr-9 text-sm text-ink-900 placeholder:text-ink-400 hover:border-ink-200 focus:bg-white"
      />
      {loading ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400">
          <Spinner className="h-4 w-4" label="Searching" />
        </span>
      ) : null}
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-pop"
        >
          {!loading && results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-ink-500">No matches for &ldquo;{query.trim()}&rdquo;</li>
          ) : null}
          {results.map((r, i) => (
            <li
              key={`${r.type}-${r.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(r);
              }}
              className={clsx("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === active && "bg-brand-50")}
            >
              {r.type === "person" ? (
                <Avatar name={r.label} path={r.person.avatar_path} userId={r.id} availability={r.person.availability} showPresence size="sm" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                  {r.kind === "channel" ? <Hash className="h-4 w-4" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-900">{r.label}</span>
                {r.sub ? <span className="block truncate text-xs text-ink-500">{r.sub}</span> : null}
              </span>
              {r.type === "person" ? <MessageSquare className="h-4 w-4 text-ink-400" aria-label="Open chat" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
