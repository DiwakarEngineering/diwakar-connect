"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight, Users, Video } from "lucide-react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";

type Row = RpcRow<"list_my_meetings">;
const DAY = 86_400_000;

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export const RESPONSE_LABEL = { pending: "Not answered", accepted: "Accepted", tentative: "Tentative", declined: "Declined" } as const;

/** Whether "Join" should be offered: from 15 minutes before the start until the end, or while a call is live. */
export function joinable(m: Pick<Row, "starts_at" | "ends_at" | "live" | "cancelled_at">, now = Date.now()) {
  if (m.cancelled_at) return false;
  return m.live || (now >= new Date(m.starts_at).getTime() - 15 * 60_000 && now <= new Date(m.ends_at).getTime());
}

/** Week calendar of my meetings (new meetings are started from the page's "New meeting" menu). */
export function MeetingsCalendar({ callsUsable, canSchedule }: { callsUsable: boolean; canSchedule: boolean }) {
  const { session } = useSession();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const supabase = getSupabaseBrowserClient();

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("list_my_meetings", {
      p_from: week.toISOString(),
      p_to: new Date(week.getTime() + 7 * DAY).toISOString(),
    });
    if (e) return setError(friendlyError(e, "Couldn't load your meetings."));
    setError(null);
    setRows(data ?? []);
  }, [supabase, week]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("my-meetings")
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => void load())
      .subscribe();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(t);
      void supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  const people = usePeopleById((rows ?? []).map((r) => r.organizer_id));
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(week.getTime() + i * DAY);
      const next = day.getTime() + DAY;
      return { day, items: (rows ?? []).filter((r) => new Date(r.starts_at).getTime() < next && new Date(r.starts_at).getTime() >= day.getTime()) };
    });
  }, [rows, week]);
  const today = new Date().toDateString();

  return (
    <section aria-labelledby="meetings-heading">
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <CalendarDays className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <h2 id="meetings-heading" className="text-sm font-semibold text-ink-900">
            Meetings
          </h2>
          <span className="hidden text-sm text-ink-500 sm:inline" aria-hidden="true">·</span>
          <span className="whitespace-nowrap text-sm text-ink-600">
            {week.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – {new Date(week.getTime() + 6 * DAY).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            <span className="hidden sm:inline">, {new Date(week.getTime() + 6 * DAY).getFullYear()}</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setWeek((w) => new Date(w.getTime() - 7 * DAY))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100" aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setWeek(startOfWeek(new Date()))} className="h-8 whitespace-nowrap rounded-lg px-2 text-xs font-medium text-ink-700 hover:bg-ink-100">
              This week
            </button>
            <button type="button" onClick={() => setWeek((w) => new Date(w.getTime() + 7 * DAY))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100" aria-label="Next week">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />} title="No meetings this week" description={canSchedule ? "Use New meeting to start one now or schedule one." : undefined} />
        ) : (
          <ol className="divide-y divide-line">
            {days
              .filter((d) => d.items.length)
              .map((d) => (
                <li key={d.day.toISOString()} className="px-4 py-3">
                  <h3 className={clsx("mb-2 text-xs font-semibold uppercase tracking-wide", d.day.toDateString() === today ? "text-brand-700" : "text-ink-500")}>
                    {d.day.toDateString() === today ? "Today · " : ""}
                    {d.day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                  </h3>
                  <ul className="space-y-2">
                    {d.items.map((m) => {
                      const canJoin = joinable(m, now) && callsUsable;
                      const organizer = m.organizer_id === session.userId ? "You" : (m.organizer_id && people.get(m.organizer_id)?.display_name) || "Organizer";
                      return (
                        <li
                          key={m.meeting_id}
                          className={clsx("flex items-center gap-3 rounded-xl border px-3 py-2.5", m.cancelled_at ? "border-line bg-canvas opacity-70" : m.live ? "border-success-600/30 bg-success-50/50" : "border-line")}
                        >
                          <div className="w-20 shrink-0 text-xs tabular-nums text-ink-600">
                            <div className="font-semibold text-ink-900">{time(m.starts_at)}</div>
                            <div>{time(m.ends_at)}</div>
                          </div>
                          <span className="h-9 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                          <Link href={`/meetings/${m.meeting_id}`} className="min-w-0 flex-1">
                            <span className={clsx("block truncate text-sm font-semibold text-ink-900 hover:underline", m.cancelled_at && "line-through")}>{m.title}</span>
                            <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                              <span>{organizer}</span>
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3 w-3" aria-hidden="true" />
                                {m.invitee_count}
                              </span>
                              {m.cancelled_at ? <span className="font-medium text-danger-600">Cancelled</span> : m.my_response && m.my_response !== "accepted" ? <span>{RESPONSE_LABEL[m.my_response]}</span> : null}
                              {m.live ? <span className="font-semibold text-success-700">● Live now</span> : null}
                            </span>
                          </Link>
                          {canJoin ? (
                            <Link href={`/call/${m.conversation_id}?media=video`} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-700">
                              <Video className="h-3.5 w-3.5" aria-hidden="true" />
                              Join
                            </Link>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
          </ol>
        )}
      </div>

    </section>
  );
}
