"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { usePeopleById } from "@/components/providers/people-provider";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";

type Row = Tables<"meetings"> & { invitees: number; guests: number };
type Range = "upcoming" | "past";

/** Meeting log for administrators: every meeting, organizer, invitees, guests, status; details show attendance. */
export default function AdminMeetingsPage() {
  const supabase = getSupabaseBrowserClient();
  const [range, setRange] = useState<Range>("upcoming");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const now = new Date().toISOString();
    let q = supabase.from("meetings").select("*").limit(200);
    q = range === "upcoming" ? q.gte("ends_at", now).order("starts_at", { ascending: true }) : q.lt("ends_at", now).order("starts_at", { ascending: false });
    const { data, error: e } = await q;
    if (e) return setError(friendlyError(e, "Couldn't load meetings."));
    const ids = (data ?? []).map((m) => m.id);
    const [inv, lob] = ids.length
      ? await Promise.all([
          supabase.from("meeting_invitees").select("meeting_id").in("meeting_id", ids),
          supabase.from("meeting_lobby").select("meeting_id, guest_name, status").in("meeting_id", ids),
        ])
      : [{ data: [] }, { data: [] }];
    const count = (list: { meeting_id: string }[] | null, id: string) => (list ?? []).filter((x) => x.meeting_id === id).length;
    setError(null);
    setRows(
      (data ?? []).map((m) => ({
        ...m,
        invitees: count(inv.data, m.id),
        guests: ((lob.data ?? []) as { meeting_id: string; guest_name: string | null; status: string }[]).filter(
          (l) => l.meeting_id === m.id && l.guest_name && (l.status === "admitted" || l.status === "left"),
        ).length,
      })),
    );
  }, [range, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = usePeopleById((rows ?? []).map((r) => r.organizer_id));
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-600">Every scheduled meeting in the organization. Open one for invitees, responses and attendance. Changes are in the audit log.</p>
        <div role="tablist" aria-label="Meetings" className="flex shrink-0 gap-1">
          {(["upcoming", "past"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={clsx("rounded-full px-3 py-1 text-xs font-medium", range === r ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200")}
            >
              {r === "upcoming" ? "Upcoming" : "Past"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-card">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <SkeletonRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState title={range === "upcoming" ? "No upcoming meetings" : "No past meetings"} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Meeting</th>
                <th className="px-4 py-2.5 font-semibold">Organizer</th>
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 font-semibold">Invited</th>
                <th className="px-4 py-2.5 font-semibold">Guests</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/meetings/${m.id}`} className="font-medium text-ink-900 hover:underline">
                      {m.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink-700">{(m.organizer_id && people.get(m.organizer_id)?.display_name) || "Former employee"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-700">{fmt(m.starts_at)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-700">{m.invitees}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-700">{m.allow_guests ? m.guests : "—"}</td>
                  <td className="px-4 py-2.5">
                    {m.cancelled_at ? (
                      <span className="text-danger-600">Cancelled</span>
                    ) : new Date(m.ends_at) < new Date() ? (
                      <span className="text-ink-500">Ended</span>
                    ) : (
                      <span className="text-success-700">Scheduled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
