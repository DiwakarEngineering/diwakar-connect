"use client";

import { useEffect, useId, useState } from "react";
import { Search } from "lucide-react";
import type { Person } from "@/components/providers/people-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { fullDateTime } from "@/lib/format";
import { Spinner } from "@/components/ui/spinner";
import { SidePanel } from "./side-panel";
import { MESSAGE_COLUMNS, type Message } from "./types";

type Props = {
  conversationId: string;
  /** Only search messages after the person's "Clear chat history". */
  clearedAt: string | null;
  people: Map<string, Person>;
  isLoaded: (id: string) => boolean;
  onJump: (id: string) => void;
  onClose: () => void;
};

/** Full-text search within one conversation (server-side, RLS-scoped). */
export function SearchPanel({ conversationId, clearedAt, people, isLoaded, onJump, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const { data, error: searchError } = await getSupabaseBrowserClient()
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .eq("kind", "user")
        .is("deleted_at", null)
        .gt("created_at", clearedAt ?? "-infinity")
        .textSearch("search", q, { type: "websearch", config: "simple" })
        .order("created_at", { ascending: false })
        .limit(30);
      setLoading(false);
      if (searchError) {
        setError(friendlyError(searchError, "Search failed."));
        return;
      }
      setError(null);
      setResults(data ?? []);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [clearedAt, conversationId, query]);

  return (
    <SidePanel title="Search messages" onClose={onClose}>
      <div className="border-b border-line p-3">
        <label htmlFor={inputId} className="sr-only">
          Search messages in this conversation
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            id={inputId}
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Words to find"
            className="h-10 w-full rounded-lg border border-line pl-9 pr-9 text-sm"
          />
          {loading ? (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400">
              <Spinner className="h-4 w-4" label="Searching" />
            </span>
          ) : null}
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {error ? (
          <p role="alert" className="p-4 text-sm text-danger-600">
            {error}
          </p>
        ) : results === null ? (
          <p className="p-6 text-center text-sm text-ink-500">Type at least two characters.</p>
        ) : results.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-500">No messages match.</p>
        ) : (
          <ul className="divide-y divide-line">
            {results.map((m) => {
              const loaded = isLoaded(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={!loaded}
                    onClick={() => onJump(m.id)}
                    className="w-full px-4 py-3 text-left hover:bg-canvas disabled:cursor-default"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink-900">
                        {(m.sender_id && people.get(m.sender_id)?.display_name) || "Unknown"}
                      </span>
                      <time className="shrink-0 text-[11px] text-ink-400" dateTime={m.created_at}>
                        {fullDateTime(m.created_at)}
                      </time>
                    </div>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-ink-700">{m.body}</p>
                    {loaded ? <span className="text-[11px] font-medium text-brand-700">Show in conversation</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SidePanel>
  );
}
