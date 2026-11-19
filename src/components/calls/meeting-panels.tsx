"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { Participant } from "livekit-client";
import { Hand, Link2, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, Search, UserMinus, UserPlus, Video, VideoOff, X } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Person } from "@/components/providers/people-provider";
import { Avatar } from "@/components/ui/avatar";
import { Menu } from "@/components/ui/menu";

export type Ring = Pick<Tables<"call_invites">, "user_id" | "status">;

/** Live ring statuses for a call (who is ringing, declined, missed, accepted). */
export function useRings(callId: string | null) {
  const [rings, setRings] = useState<Ring[]>([]);
  useEffect(() => {
    if (!callId) return;
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;
    const load = () =>
      void supabase
        .from("call_invites")
        .select("user_id, status")
        .eq("call_id", callId)
        .then(({ data }) => {
          if (!cancelled) setRings(data ?? []);
        });
    load();
    const channel = supabase
      .channel(`call-rings:${callId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_invites", filter: `call_id=eq.${callId}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [callId]);
  return rings;
}

export function handRaised(p: Participant) {
  return p.attributes?.hand === "up";
}

const RING_LABEL: Record<Ring["status"], string> = { ringing: "Ringing...", accepted: "Joined", declined: "Declined", missed: "No answer" };

export function ParticipantsPanel({
  participants,
  localIdentity,
  organizerId,
  people,
  rings,
  canModerate,
  canInvite,
  onInvite,
  onCopyLink,
  onMute,
  onRemove,
  onMuteAll,
  onClose,
}: {
  participants: Participant[];
  localIdentity: string;
  organizerId: string | null;
  people: Map<string, Person>;
  rings: Ring[];
  canModerate: boolean;
  canInvite: boolean;
  onInvite: () => void;
  onCopyLink: () => void;
  onMute: (identity: string) => void;
  onRemove: (identity: string) => void;
  onMuteAll: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const nameOf = (id: string, fallback?: string) => people.get(id)?.display_name ?? fallback ?? "Guest";
  const q = query.trim().toLowerCase();
  const inCall = useMemo(
    () =>
      participants
        .filter((p) => !q || nameOf(p.identity, p.name).toLowerCase().includes(q))
        .sort((a, b) => Number(handRaised(b)) - Number(handRaised(a))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameOf reads people
    [participants, q, people],
  );
  const present = new Set(participants.map((p) => p.identity));
  const notJoined = rings.filter((r) => !present.has(r.user_id) && r.status !== "accepted" && (!q || nameOf(r.user_id).toLowerCase().includes(q)));
  const anyUnmuted = participants.some((p) => p.identity !== localIdentity && p.isMicrophoneEnabled);

  return (
    <aside aria-label="Participants" className="fixed inset-0 z-40 flex flex-col bg-ink-900 text-white md:static md:w-80 md:rounded-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="text-sm font-semibold">Participants</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-300 hover:bg-ink-800" aria-label="Close participants">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-2 px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search participants"
            aria-label="Search participants"
            className="h-9 w-full rounded-lg border border-ink-700 bg-ink-800 pl-9 pr-3 text-sm text-white placeholder:text-ink-400 focus:border-brand-400"
          />
        </div>
        <div className="flex gap-2">
          {canInvite ? (
            <button type="button" onClick={onInvite} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-ink-700 text-sm font-medium hover:bg-ink-800">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Invite
            </button>
          ) : null}
          <button type="button" onClick={onCopyLink} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-ink-700 text-sm font-medium hover:bg-ink-800">
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Copy link
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 pb-1 pt-2 text-xs text-ink-300">
        <span>In the meeting ({participants.length})</span>
        {canModerate && anyUnmuted ? (
          <button type="button" onClick={onMuteAll} className="rounded-md border border-ink-700 px-2 py-0.5 font-medium text-white hover:bg-ink-800">
            Mute all
          </button>
        ) : null}
      </div>
      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-3">
        {inCall.map((p) => {
          const isMe = p.identity === localIdentity;
          const role = p.identity === organizerId ? "Organizer" : p.isScreenShareEnabled ? "Presenter" : "Attendee";
          return (
            <li key={p.identity} className="group flex items-center gap-3 px-4 py-2">
              <Avatar name={nameOf(p.identity, p.name)} path={people.get(p.identity)?.avatar_path} userId={p.identity} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {nameOf(p.identity, p.name)}
                  {isMe ? " (you)" : ""}
                </span>
                <span className={clsx("block text-[11px]", role === "Attendee" ? "text-ink-400" : "text-brand-300")}>{role}</span>
              </span>
              {handRaised(p) ? <Hand className="h-4 w-4 text-brand-300" aria-label="Hand raised" /> : null}
              {p.isScreenShareEnabled ? <MonitorUp className="h-4 w-4 text-brand-300" aria-label="Sharing screen" /> : null}
              {p.isCameraEnabled ? <Video className="h-4 w-4 text-ink-300" aria-label="Camera on" /> : <VideoOff className="h-4 w-4 text-ink-500" aria-label="Camera off" />}
              {p.isMicrophoneEnabled ? <Mic className="h-4 w-4 text-ink-300" aria-label="Microphone on" /> : <MicOff className="h-4 w-4 text-danger-50" aria-label="Muted" />}
              {canModerate && !isMe ? (
                <Menu
                  label={`Options for ${nameOf(p.identity, p.name)}`}
                  trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                  triggerClassName="flex h-7 w-7 items-center justify-center rounded-md text-ink-300 hover:bg-ink-800"
                  items={[
                    { label: "Mute", icon: <MicOff className="h-4 w-4" />, disabled: !p.isMicrophoneEnabled, onSelect: () => onMute(p.identity) },
                    { type: "separator" },
                    { label: "Remove from meeting", icon: <UserMinus className="h-4 w-4" />, danger: true, onSelect: () => onRemove(p.identity) },
                  ]}
                />
              ) : null}
            </li>
          );
        })}
        {notJoined.length ? (
          <>
            <li className="px-4 pb-1 pt-4 text-xs text-ink-300">Invited ({notJoined.length})</li>
            {notJoined.map((r) => (
              <li key={r.user_id} className="flex items-center gap-3 px-4 py-2 opacity-80">
                <Avatar name={nameOf(r.user_id)} path={people.get(r.user_id)?.avatar_path} userId={r.user_id} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{nameOf(r.user_id)}</span>
                <span className={clsx("text-[11px]", r.status === "declined" ? "text-danger-50" : "text-ink-300")}>{RING_LABEL[r.status]}</span>
              </li>
            ))}
          </>
        ) : null}
      </ul>
    </aside>
  );
}

/**
 * Caller's view while nobody has joined yet: who is being rung, with Cancel.
 * Shows "Declined" / "No answer" when that happens.
 */
export function OutgoingRing({ rings, people, onCancel }: { rings: Ring[]; people: Map<string, Person>; onCancel: () => void }) {
  const ringing = rings.filter((r) => r.status === "ringing");
  const declined = rings.filter((r) => r.status === "declined");
  const allDone = rings.length > 0 && ringing.length === 0;
  const shown = rings.slice(0, 4);
  const names = rings.map((r) => people.get(r.user_id)?.display_name?.split(" ")[0] ?? "Colleague");
  const title =
    rings.length === 0
      ? "Waiting for others to join..."
      : allDone
        ? declined.length === rings.length
          ? `${names.length === 1 ? names[0] : "Everyone"} declined`
          : "No answer"
        : rings.length === 1
          ? `Calling ${people.get(rings[0]!.user_id)?.display_name ?? "your colleague"}...`
          : `Calling ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}...`;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center" role="status" aria-live="polite">
      <div className="flex -space-x-3">
        {shown.map((r) => (
          <span key={r.user_id} className={clsx("rounded-full ring-4 ring-ink-950", r.status === "ringing" && "motion-safe:animate-pulse")}>
            <Avatar name={people.get(r.user_id)?.display_name ?? "Colleague"} path={people.get(r.user_id)?.avatar_path} userId={r.user_id} size="xl" />
          </span>
        ))}
      </div>
      <div>
        <p className="text-lg font-semibold text-white">{title}</p>
        {!allDone && rings.length ? <p className="mt-1 text-sm text-ink-300">They&apos;ll join here when they answer.</p> : null}
      </div>
      <button type="button" onClick={onCancel} className="flex h-11 items-center gap-2 rounded-full bg-danger-600 px-5 text-sm font-semibold text-white hover:bg-danger-700">
        <PhoneOff className="h-4 w-4" aria-hidden="true" />
        {allDone ? "Close" : "Cancel call"}
      </button>
    </div>
  );
}
