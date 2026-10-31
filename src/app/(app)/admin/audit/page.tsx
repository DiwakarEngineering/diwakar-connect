"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import type { Json, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { fullDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { usePeopleById } from "@/components/providers/people-provider";

type AuditRow = Tables<"audit_logs">;
const PAGE_SIZE = 50;

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All events" },
  { value: "user.", label: "People & roles" },
  { value: "team", label: "Teams & membership" },
  { value: "channel", label: "Channels" },
  { value: "department.", label: "Departments" },
  { value: "organization", label: "Organization settings" },
  { value: "message.", label: "Moderation" },
];

function describeMetadata(metadata: Json): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return Object.entries(metadata)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default function AdminAuditPage() {
  const supabase = getSupabaseBrowserClient();
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let query = supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (category) query = query.like("action", `${category}%`);
    const { data, count, error: loadError } = await query;
    if (loadError) return setError(friendlyError(loadError, "Couldn't load the audit log."));
    setError(null);
    setRows(data ?? []);
    setTotal(count ?? 0);
  }, [category, page, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = usePeopleById(
    (rows ?? []).flatMap((r) => [r.actor_id, r.target_type === "user" ? r.target_id : null]),
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Append-only record of administrative actions. Message content and secrets are never logged.</p>
        <Select
          aria-label="Filter events"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
          className="w-56"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ScrollText className="h-5 w-5" aria-hidden="true" />} title="No events recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-semibold">When</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Actor</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Action</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Target</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-600">{fullDateTime(r.created_at)}</td>
                    <td className="px-4 py-3 text-ink-900">
                      {r.actor_id ? (people.get(r.actor_id)?.display_name ?? "Former user") : <span className="text-ink-500">System</span>}
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-800">{r.action}</code>
                    </td>
                    <td className="px-4 py-3 text-ink-700">
                      {r.target_type === "user" && r.target_id
                        ? (people.get(r.target_id)?.display_name ?? "User")
                        : r.target_type ?? "—"}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-ink-500">{describeMetadata(r.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {total > PAGE_SIZE ? (
        <nav aria-label="Audit log pages" className="mt-4 flex items-center justify-between text-sm text-ink-600">
          <span>
            Page {page + 1} of {pages}
          </span>
          <span className="flex gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        </nav>
      ) : null}
    </div>
  );
}
