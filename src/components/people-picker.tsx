"use client";

import { useEffect, useId, useState } from "react";
import clsx from "clsx";
import { Check, Search, X } from "lucide-react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";

type Entry = RpcRow<"search_directory">;
export type PickedPerson = { id: string; display_name: string; avatar_path: string | null };

type Props = {
  selected: PickedPerson[];
  onChange: (people: PickedPerson[]) => void;
  /** People who can't be picked (e.g. already members). */
  excludeIds?: string[];
  /** Only these people can be picked (e.g. team members for a private channel). */
  restrictToIds?: string[];
  max?: number;
  label?: string;
};

/** Searchable multi-select of active employees. */
export function PeoplePicker({ selected, onChange, excludeIds = [], restrictToIds, max = 50, label = "Search people" }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const excludeKey = excludeIds.join(",");
  const restrictKey = restrictToIds?.join(",") ?? null;

  useEffect(() => {
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const { data, error: searchError } = await getSupabaseBrowserClient().rpc("search_directory", {
        p_query: query.trim() || null,
        p_limit: 30,
      });
      setLoading(false);
      if (searchError) {
        setError(friendlyError(searchError));
        return;
      }
      setError(null);
      const excluded = new Set(excludeKey ? excludeKey.split(",") : []);
      const allowed = restrictKey !== null ? new Set(restrictKey ? restrictKey.split(",") : []) : null;
      setResults(
        (data ?? []).filter((p) => p.employment_status === "active" && !excluded.has(p.id) && (!allowed || allowed.has(p.id))),
      );
    }, 200);
    return () => window.clearTimeout(handle);
  }, [excludeKey, query, restrictKey]);

  const selectedIds = new Set(selected.map((p) => p.id));

  function toggle(p: Entry) {
    if (selectedIds.has(p.id)) onChange(selected.filter((s) => s.id !== p.id));
    else if (selected.length < max) onChange([...selected, { id: p.id, display_name: p.display_name, avatar_path: p.avatar_path }]);
  }

  return (
    <div className="space-y-3">
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected people">
          {selected.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-1.5 text-xs font-medium text-brand-800">
              <Avatar name={p.display_name} path={p.avatar_path} userId={p.id} size="xs" />
              {p.display_name}
              <button
                type="button"
                onClick={() => onChange(selected.filter((s) => s.id !== p.id))}
                className="rounded-full p-0.5 hover:bg-brand-100"
                aria-label={`Remove ${p.display_name}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, title or department"
          className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm placeholder:text-ink-400"
        />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
        {loading ? (
          <div className="flex justify-center py-6 text-ink-400">
            <Spinner className="h-4 w-4" label="Searching" />
          </div>
        ) : error ? (
          <p className="px-3 py-4 text-sm text-danger-600" role="alert">
            {error}
          </p>
        ) : results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-500">No one found.</p>
        ) : (
          <ul aria-label="People">
            {results.map((p) => {
              const isSelected = selectedIds.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggle(p)}
                    className={clsx(
                      "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-canvas",
                      isSelected && "bg-brand-50/60",
                    )}
                  >
                    <Avatar name={p.display_name} path={p.avatar_path} userId={p.id} availability={p.availability} showPresence size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">{p.display_name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {[p.title, p.department_name].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        "flex h-5 w-5 items-center justify-center rounded-md border",
                        isSelected ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300 bg-white",
                      )}
                      aria-hidden="true"
                    >
                      {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
