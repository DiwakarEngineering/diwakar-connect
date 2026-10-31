"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, PhoneCall, Video, WifiOff } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { duration, fullDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useCallConfig } from "@/components/calls/use-call-config";
import { useConversationTitles } from "@/components/calls/use-conversation-titles";

type CallRow = Tables<"calls"> & { participantCount: number };

export default function CallsPage() {
  const router = useRouter();
  const { session, isAdmin } = useSession();
  const { push } = useToast();
  const config = useCallConfig();
  const titles = useConversationTitles();
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState<"audio" | "video" | null>(null);
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [starting, setStarting] = useState(false);
  const supabase = getSupabaseBrowserClient();

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("calls").select("*").order("started_at", { ascending: false }).limit(50);
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load call history."));
      return;
    }
    const ids = (data ?? []).map((c) => c.id);
    const { data: parts } = ids.length
      ? await supabase.from("call_participants").select("call_id, user_id").in("call_id", ids)
      : { data: [] as { call_id: string; user_id: string }[] };
    const counts = new Map<string, Set<string>>();
    for (const p of parts ?? []) counts.set(p.call_id, (counts.get(p.call_id) ?? new Set()).add(p.user_id));
    setError(null);
    setCalls((data ?? []).map((c) => ({ ...c, participantCount: counts.get(c.id)?.size ?? 0 })));
  }, [supabase]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("calls-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, supabase]);

  const people = usePeopleById((calls ?? []).map((c) => c.started_by));

  async function startCall() {
    const person = picked[0];
    if (!person || !startOpen) return;
    setStarting(true);
    const { data, error: rpcError } = await supabase.rpc("get_or_create_direct_conversation", { p_other_user: person.id });
    setStarting(false);
    if (rpcError || !data) {
      push({ tone: "error", title: "Couldn't start the call", description: friendlyError(rpcError) });
      return;
    }
    router.push(`/call/${data}?media=${startOpen}`);
  }

  const ready = config.status === "ready";
  const usable = ready && config.providerConfigured && config.enabledByOrganization;
  const live = (calls ?? []).filter((c) => c.status === "active");
  const past = (calls ?? []).filter((c) => c.status === "ended");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="hidden text-xl font-semibold text-ink-900 md:block">Calls</h1>
            <p className="text-sm text-ink-500">Audio and video calls with colleagues. Calls are never recorded.</p>
          </div>
          <div className="flex gap-2">
            <Button disabled={!usable} onClick={() => setStartOpen("audio")}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              Audio call
            </Button>
            <Button variant="primary" disabled={!usable} onClick={() => setStartOpen("video")}>
              <Video className="h-4 w-4" aria-hidden="true" />
              Video call
            </Button>
          </div>
        </div>

        {config.status === "loading" ? (
          <LoadingState label="Checking call service" />
        ) : !usable ? (
          <div role="status" className="mt-5 flex gap-3 rounded-2xl border border-warning-600/20 bg-warning-50 p-4">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" aria-hidden="true" />
            <div className="text-sm text-warning-700">
              <p className="font-semibold">Calling isn&apos;t available right now</p>
              <p className="mt-0.5">
                {config.status === "error"
                  ? "We couldn't check the call service. Try reloading the page."
                  : !config.providerConfigured
                    ? "The call provider (LiveKit) hasn't been configured on this server."
                    : "Calls are turned off in your organization's settings."}
                {isAdmin && config.status === "ready" && !config.providerConfigured
                  ? " Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to the server environment and redeploy - see the README."
                  : " Chat and teams work as normal."}
              </p>
            </div>
          </div>
        ) : null}

        <section className="mt-6" aria-labelledby="live-heading">
          <h2 id="live-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            In progress
          </h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white">
            {error ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : calls === null ? (
              <SkeletonRows rows={2} />
            ) : live.length === 0 ? (
              <EmptyState title="No calls in progress" description="Start a call from any chat or channel, or with the buttons above." />
            ) : (
              <ul className="divide-y divide-line">
                {live.map((c) => {
                  const label = titles.get(c.conversation_id);
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success-50 text-success-700">
                        <PhoneCall className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink-900">{label?.title ?? "Call"}</div>
                        <div className="text-xs text-ink-500">
                          {c.participantCount} joined · running {duration(c.started_at, null)}
                        </div>
                      </div>
                      <Link
                        href={`/call/${c.conversation_id}?media=${c.media}`}
                        className="inline-flex h-8 items-center rounded-lg bg-success-600 px-3 text-xs font-semibold text-white hover:bg-success-700"
                      >
                        Join
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-8" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Recent calls
          </h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white">
            {calls === null ? (
              <SkeletonRows rows={4} />
            ) : past.length === 0 ? (
              <EmptyState title="No call history yet" />
            ) : (
              <ul className="divide-y divide-line">
                {past.map((c) => {
                  const label = titles.get(c.conversation_id);
                  const starter = c.started_by === session.userId ? "You" : (c.started_by && people.get(c.started_by)?.display_name) || "Someone";
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-ink-600">
                        {c.media === "audio" ? <Phone className="h-4 w-4" aria-hidden="true" /> : <Video className="h-4 w-4" aria-hidden="true" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        {label ? (
                          <Link href={label.href} className="block truncate text-sm font-medium text-ink-900 hover:underline">
                            {label.title}
                          </Link>
                        ) : (
                          <span className="block truncate text-sm font-medium text-ink-900">Call</span>
                        )}
                        <div className="text-xs text-ink-500">
                          {starter} started · {fullDateTime(c.started_at)} · {duration(c.started_at, c.ended_at)} · {c.participantCount}{" "}
                          {c.participantCount === 1 ? "person" : "people"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <Dialog
        open={startOpen !== null}
        onClose={() => setStartOpen(null)}
        busy={starting}
        title={startOpen === "audio" ? "Start an audio call" : "Start a video call"}
        description="Choose who to call. For a group call, start it from a group chat or channel."
        footer={
          <>
            <Button onClick={() => setStartOpen(null)} disabled={starting}>
              Cancel
            </Button>
            <Button variant="primary" loading={starting} disabled={picked.length !== 1} onClick={() => void startCall()}>
              Call
            </Button>
          </>
        }
      >
        <PeoplePicker selected={picked} onChange={(p) => setPicked(p.slice(-1))} excludeIds={[session.userId]} max={1} />
      </Dialog>
    </div>
  );
}
