"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, CalendarDays, Check, Copy, MessageSquare, Pencil, UserCheck, UserX, Video, XCircle } from "lucide-react";
import type { RpcRow, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { formatMeetingCode as formatCode } from "@/lib/meetings";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useCallConfig } from "@/components/calls/use-call-config";
import { ScheduleDialog } from "@/components/meetings/schedule-dialog";
import { RESPONSE_LABEL, joinable } from "@/components/meetings/meetings-calendar";

type Meeting = Tables<"meetings">;
type Invitee = Tables<"meeting_invitees">;
type Lobby = Tables<"meeting_lobby">;


function whenText(m: Pick<Meeting, "starts_at" | "ends_at">) {
  const s = new Date(m.starts_at);
  const e = new Date(m.ends_at);
  return `${s.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  if (!isUuid(id)) return <EmptyState title="Meeting not found" className="h-full" />;
  return <MeetingDetails id={id} />;
}

function MeetingDetails({ id }: { id: string }) {
  const { session } = useSession();
  const { push } = useToast();
  const config = useCallConfig();
  const supabase = getSupabaseBrowserClient();
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [lobby, setLobby] = useState<Lobby[]>([]);
  const [attendance, setAttendance] = useState<RpcRow<"meeting_attendance">[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: m, error: e } = await supabase.from("meetings").select("*").eq("id", id).maybeSingle();
    if (e) return setError(friendlyError(e));
    setMeeting(m ?? null);
    if (!m) return;
    const [inv, manage, att, call, lob] = await Promise.all([
      supabase.from("meeting_invitees").select("*").eq("meeting_id", id),
      supabase.rpc("can_manage_meeting", { p_meeting: id }),
      supabase.rpc("meeting_attendance", { p_meeting_id: id }),
      supabase.from("calls").select("id").eq("conversation_id", m.conversation_id).eq("status", "active").maybeSingle(),
      supabase.from("meeting_lobby").select("*").eq("meeting_id", id).eq("status", "waiting").order("created_at"),
    ]);
    setInvitees(inv.data ?? []);
    setCanManage(!!manage.data);
    setAttendance(att.data ?? []);
    setLive(!!call.data);
    setLobby(lob.data ?? []);
  }, [id, supabase]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`meeting:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_lobby", filter: `meeting_id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meetings", filter: `id=eq.${id}` }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, load, supabase]);

  const people = usePeopleById([meeting?.organizer_id, ...invitees.map((i) => i.user_id), ...lobby.map((l) => l.user_id), ...attendance.map((a) => a.user_id)]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} className="h-full" />;
  if (meeting === undefined) return <LoadingState label="Opening meeting" className="h-full" />;
  if (meeting === null) return <EmptyState title="Meeting not available" description="It may have been removed, or you're not invited." className="h-full" />;

  const link = `${window.location.origin}/meet/${meeting.code}`;
  const mine = invitees.find((i) => i.user_id === session.userId);
  const organizer = meeting.organizer_id ? people.get(meeting.organizer_id) : undefined;
  const callsUsable = config.status === "ready" && config.providerConfigured && config.enabledByOrganization;
  const canJoin = callsUsable && joinable({ ...meeting, live });
  const chatHref = `/chat/${meeting.conversation_id}`;

  const copy = (text: string, what: string) =>
    void navigator.clipboard
      ?.writeText(text)
      .then(() => push({ tone: "success", title: `${what} copied` }))
      .catch(() => push({ tone: "error", title: "Couldn't copy" }));

  const invitation = [
    `${meeting.title}`,
    whenText(meeting),
    "",
    `Join: ${link}`,
    `Meeting ID: ${formatCode(meeting.code)}`,
    `Passcode: ${meeting.passcode}`,
    meeting.allow_guests ? "Guests without a Diwakar account can join with the ID and passcode; the organizer admits them." : "",
  ]
    .filter((l, i, a) => l || a[i - 1])
    .join("\n");

  async function respond(response: "accepted" | "tentative" | "declined") {
    const { error: e } = await supabase.rpc("respond_to_meeting", { p_meeting_id: id, p_response: response });
    if (e) push({ tone: "error", title: "Couldn't save your response", description: friendlyError(e) });
    else void load();
  }

  async function decide(l: Lobby, admit: boolean) {
    const { error: e } = await supabase.rpc("decide_lobby", { p_lobby_id: l.id, p_admit: admit });
    if (e) push({ tone: "error", title: "Couldn't update the lobby", description: friendlyError(e) });
    else void load();
  }

  async function cancel() {
    setBusy(true);
    const { error: e } = await supabase.rpc("cancel_meeting", { p_meeting_id: id });
    setBusy(false);
    setCancelOpen(false);
    if (e) push({ tone: "error", title: "Couldn't cancel the meeting", description: friendlyError(e) });
    else {
      push({ tone: "success", title: "Meeting cancelled; invitees were told" });
      void load();
    }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:px-8">
        <Link href="/calls" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Calls and meetings
        </Link>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-card md:p-6">
          <div className="flex flex-wrap items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <CalendarDays className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className={clsx("text-xl font-semibold text-ink-900", meeting.cancelled_at && "line-through")}>{meeting.title}</h1>
              <p className="mt-1 text-sm text-ink-600">{whenText(meeting)}</p>
              <p className="mt-1 text-sm text-ink-500">
                Organized by {meeting.organizer_id === session.userId ? "you" : (organizer?.display_name ?? "a former employee")}
                {meeting.channel_id ? " · team channel meeting" : ""}
              </p>
              {meeting.cancelled_at ? <p className="mt-2 text-sm font-semibold text-danger-600">This meeting was cancelled.</p> : null}
              {live && !meeting.cancelled_at ? <p className="mt-2 text-sm font-semibold text-success-700">● The meeting is live now</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {canJoin ? (
                <Link href={`/call/${meeting.conversation_id}?media=video`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                  <Video className="h-4 w-4" aria-hidden="true" /> Join meeting
                </Link>
              ) : null}
              <Link href={chatHref} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-medium text-ink-800 hover:bg-canvas">
                <MessageSquare className="h-4 w-4" aria-hidden="true" /> Meeting chat
              </Link>
            </div>
          </div>
          {meeting.description ? <p className="mt-4 whitespace-pre-wrap rounded-xl bg-canvas p-4 text-sm text-ink-700">{meeting.description}</p> : null}

          {mine && meeting.organizer_id !== session.userId && !meeting.cancelled_at ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span className="mr-1 text-sm text-ink-600">Your response:</span>
              {(["accepted", "tentative", "declined"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => void respond(r)}
                  aria-pressed={mine.response === r}
                  className={clsx(
                    "inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-sm font-medium",
                    mine.response === r ? "border-brand-600 bg-brand-600 text-white" : "border-line text-ink-700 hover:bg-canvas",
                  )}
                >
                  {mine.response === r ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  {r === "accepted" ? "Accept" : r === "tentative" ? "Tentative" : "Decline"}
                </button>
              ))}
            </div>
          ) : null}

          {canManage && !meeting.cancelled_at ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <Button onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
              </Button>
              <Button onClick={() => setCancelOpen(true)}>
                <XCircle className="h-4 w-4" aria-hidden="true" /> Cancel meeting
              </Button>
            </div>
          ) : null}
        </section>

        {!meeting.cancelled_at ? (
          <section className="rounded-2xl border border-line bg-white p-5 shadow-card" aria-labelledby="join-info">
            <h2 id="join-info" className="text-base font-semibold text-ink-900">Joining information</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-500">Meeting ID</dt>
                <dd className="font-mono text-base font-semibold tracking-wide text-ink-900">{formatCode(meeting.code)}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Passcode</dt>
                <dd className="font-mono text-base font-semibold tracking-widest text-ink-900">{meeting.passcode}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Guests</dt>
                <dd className="text-ink-900">{meeting.allow_guests ? "Allowed (admitted from the lobby)" : "Employees only"}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-canvas px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-ink-700">{link}</span>
              <button type="button" onClick={() => copy(link, "Link")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-white">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy link
              </button>
              <button type="button" onClick={() => copy(invitation, "Invitation")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-white">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy invitation
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-500">Invitees join straight away. Others with the link wait in the lobby until the organizer admits them.</p>
          </section>
        ) : null}

        {canManage && lobby.length ? (
          <section className="rounded-2xl border border-brand-200 bg-brand-50/50 p-5" aria-labelledby="lobby-heading" aria-live="polite">
            <h2 id="lobby-heading" className="text-base font-semibold text-ink-900">Waiting in the lobby ({lobby.length})</h2>
            <ul className="mt-3 space-y-2">
              {lobby.map((l) => {
                const p = l.user_id ? people.get(l.user_id) : undefined;
                const name = l.guest_name ? `${l.guest_name} (guest)` : (p?.display_name ?? "Employee");
                return (
                  <li key={l.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
                    <Avatar name={l.guest_name ?? p?.display_name ?? "?"} path={p?.avatar_path} userId={l.user_id ?? l.id} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{name}</span>
                    <Button size="sm" variant="primary" onClick={() => void decide(l, true)}>
                      <UserCheck className="h-4 w-4" aria-hidden="true" /> Admit
                    </Button>
                    <Button size="sm" onClick={() => void decide(l, false)}>
                      <UserX className="h-4 w-4" aria-hidden="true" /> Reject
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="rounded-2xl border border-line bg-white p-5 shadow-card" aria-labelledby="invitees-heading">
          <h2 id="invitees-heading" className="text-base font-semibold text-ink-900">Invited ({invitees.length})</h2>
          <ul className="mt-3 divide-y divide-line">
            {invitees.map((i) => {
              const p = people.get(i.user_id);
              return (
                <li key={i.user_id} className="flex items-center gap-3 py-2">
                  <Avatar name={p?.display_name ?? "?"} path={p?.avatar_path} userId={i.user_id} availability={p?.availability} showPresence size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                    {p?.display_name ?? "Former employee"}
                    {i.user_id === meeting.organizer_id ? <span className="ml-2 text-xs text-brand-700">Organizer</span> : null}
                  </span>
                  <span className={clsx("text-xs", i.response === "declined" ? "text-danger-600" : i.response === "accepted" ? "text-success-700" : "text-ink-500")}>
                    {RESPONSE_LABEL[i.response]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-card" aria-labelledby="attendance-heading">
          <h2 id="attendance-heading" className="text-base font-semibold text-ink-900">Attendance</h2>
          {attendance.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">No one has joined yet. Attendance is recorded automatically when people join the meeting.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Name</th>
                    <th className="py-2 pr-3 font-semibold">Joined</th>
                    <th className="py-2 pr-3 font-semibold">Left</th>
                    <th className="py-2 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {attendance.map((a, i) => (
                    <tr key={a.user_id ?? `g${i}`}>
                      <td className="py-2 pr-3 text-ink-900">{a.guest_name ? `${a.guest_name} (guest)` : (a.user_id && people.get(a.user_id)?.display_name) || "Former employee"}</td>
                      <td className="py-2 pr-3 tabular-nums text-ink-700">{fmt(a.first_joined)}</td>
                      <td className="py-2 pr-3 tabular-nums text-ink-700">{a.guest_name ? "—" : fmt(a.last_left)}</td>
                      <td className="py-2 tabular-nums text-ink-700">{a.minutes ? `${a.minutes} min` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <ScheduleDialog
        open={editOpen}
        meeting={meeting}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          push({ tone: "success", title: "Meeting updated; invitees were told" });
          void load();
        }}
      />
      <ConfirmDialog
        open={cancelOpen}
        busy={busy}
        title="Cancel this meeting?"
        description="Everyone invited is notified. The meeting chat stays."
        confirmLabel="Cancel meeting"
        onConfirm={() => void cancel()}
        onClose={() => setCancelOpen(false)}
      />
    </div>
  );
}
