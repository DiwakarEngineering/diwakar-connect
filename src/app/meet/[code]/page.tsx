"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Clock, ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError, readApiError } from "@/lib/errors";
import { formatMeetingCode } from "@/lib/meetings";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { GuestRoom } from "@/components/meetings/guest-room";

type View =
  | { kind: "loading" }
  | { kind: "message"; title: string; text: string }
  | { kind: "employee-ask"; title: string; starts: string }
  | { kind: "employee-wait"; title: string; lobbyId: string }
  | { kind: "guest-form" }
  | { kind: "guest-wait"; title: string; admitted: boolean }
  | { kind: "guest-call"; title: string; token: string; serverUrl: string };

type GuestReq = { requestId: string; secret: string };
const STORE = "dc:guest-request";

/**
 * Meeting link: /meet/<meeting ID>?p=<passcode>.
 * - Invited employees (signed in) go straight to the meeting.
 * - Other employees enter the passcode and wait in the lobby.
 * - External guests (signed out) enter their name and the passcode, wait in the
 *   lobby, and join once the organizer admits them (if the meeting allows guests).
 */
export default function MeetLinkPage() {
  const { code } = useParams<{ code: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const digits = (code ?? "").replace(/\D/g, "");
  const [view, setView] = useState<View>({ kind: "loading" });
  const [passcode, setPasscode] = useState((search.get("p") ?? "").toUpperCase());
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guestReq = useRef<GuestReq | null>(null);

  const goToMeeting = useCallback(async () => {
    const { data } = await supabase.rpc("meeting_by_code", { p_code: digits });
    const m = data?.[0];
    if (m?.conversation_id) router.replace(`/call/${m.conversation_id}?media=video`);
  }, [digits, router, supabase]);

  // Who is this?
  useEffect(() => {
    if (digits.length !== 10) {
      setView({ kind: "message", title: "Meeting link not valid", text: "Check the meeting ID and try again." });
      return;
    }
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as (GuestReq & { code: string }) | null;
          if (saved?.code === digits) {
            guestReq.current = saved;
            setView({ kind: "guest-wait", title: "", admitted: false });
            return;
          }
        } catch {
          /* storage unavailable */
        }
        setView({ kind: "guest-form" });
        return;
      }
      const { data, error: e } = await supabase.rpc("meeting_by_code", { p_code: digits });
      const m = data?.[0];
      if (e || !m) return setView({ kind: "message", title: "Meeting not found", text: "Check the meeting ID, or ask the organizer for a new link." });
      if (m.cancelled) return setView({ kind: "message", title: "This meeting was cancelled", text: m.title });
      if (m.is_member && m.conversation_id) return router.replace(`/call/${m.conversation_id}?media=video`);
      setView({ kind: "employee-ask", title: m.title, starts: m.starts_at });
    })();
  }, [digits, router, supabase]);

  // Employee waiting in the lobby: follow their own request.
  useEffect(() => {
    if (view.kind !== "employee-wait") return;
    const check = async () => {
      const { data } = await supabase.from("meeting_lobby").select("status").eq("id", view.lobbyId).maybeSingle();
      if (data?.status === "admitted") void goToMeeting();
      if (data?.status === "rejected") setView({ kind: "message", title: "You weren't admitted", text: "The organizer declined your request to join." });
    };
    const channel = supabase
      .channel(`lobby:${view.lobbyId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meeting_lobby", filter: `id=eq.${view.lobbyId}` }, () => void check())
      .subscribe();
    const t = window.setInterval(() => void check(), 5000);
    return () => {
      window.clearInterval(t);
      void supabase.removeChannel(channel);
    };
  }, [goToMeeting, supabase, view]);

  // Guest waiting: poll the server.
  useEffect(() => {
    if (view.kind !== "guest-wait" || !guestReq.current) return;
    let stop = false;
    const poll = async () => {
      const res = await fetch("/api/meetings/guest/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(guestReq.current) }).catch(() => null);
      if (stop || !res) return;
      if (!res.ok) {
        sessionStorage.removeItem(STORE);
        setView({ kind: "message", title: "Request expired", text: (await readApiError(res)).message });
        return;
      }
      const body = (await res.json()) as { status: string; title?: string; token?: string; serverUrl?: string; reason?: string };
      if (body.status === "rejected") {
        sessionStorage.removeItem(STORE);
        setView({ kind: "message", title: "You weren't admitted", text: body.reason ?? "The organizer declined your request to join." });
      } else if (body.status === "left") {
        sessionStorage.removeItem(STORE);
        setView({ kind: "guest-form" });
      } else if (body.token && body.serverUrl) {
        setView({ kind: "guest-call", title: body.title ?? "Meeting", token: body.token, serverUrl: body.serverUrl });
      } else {
        setView({ kind: "guest-wait", title: body.title ?? "", admitted: body.status === "admitted" });
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), 3000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [view.kind]);

  async function askAsEmployee() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("request_meeting_access", { p_code: digits, p_passcode: passcode });
    setBusy(false);
    if (e) return setError(friendlyError(e, "Couldn't ask to join."));
    if (!data) return void goToMeeting();
    setView({ kind: "employee-wait", title: view.kind === "employee-ask" ? view.title : "", lobbyId: data });
  }

  async function askAsGuest() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meetings/guest/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: digits, passcode, name }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Can't reach Diwakar Connect. Check your connection.");
    if (!res.ok) return setError((await readApiError(res)).message);
    const body = (await res.json()) as GuestReq & { title: string };
    guestReq.current = { requestId: body.requestId, secret: body.secret };
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ ...guestReq.current, code: digits }));
    } catch {
      /* storage unavailable */
    }
    setView({ kind: "guest-wait", title: body.title, admitted: false });
  }

  const leaveAsGuest = useCallback(
    (message: string) => {
      if (guestReq.current) {
        void fetch("/api/meetings/guest/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(guestReq.current), keepalive: true });
      }
      try {
        sessionStorage.removeItem(STORE);
      } catch {
        /* ignore */
      }
      guestReq.current = null;
      setView({ kind: "message", title: "You've left the meeting", text: message });
    },
    [],
  );

  if (view.kind === "guest-call") return <GuestRoom token={view.token} serverUrl={view.serverUrl} title={view.title} onLeft={leaveAsGuest} />;

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold text-ink-900">Diwakar Connect</p>
            <p className="text-xs text-ink-500">Meeting ID {digits.length === 10 ? formatMeetingCode(digits) : code}</p>
          </div>
        </div>

        {view.kind === "loading" ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-ink-400" label="Opening meeting" />
          </div>
        ) : view.kind === "message" ? (
          <div className="space-y-2 text-center">
            <h1 className="text-lg font-semibold text-ink-900">{view.title}</h1>
            <p className="text-sm text-ink-600">{view.text}</p>
          </div>
        ) : view.kind === "employee-ask" ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void askAsEmployee();
            }}
          >
            <div>
              <h1 className="text-lg font-semibold text-ink-900">{view.title}</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-600">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                {new Date(view.starts).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
            <p className="text-sm text-ink-600">You aren&apos;t on the invite list. Enter the passcode to ask the organizer to let you in.</p>
            <FormError message={error} />
            <Field label="Passcode">
              <Input value={passcode} onChange={(e) => setPasscode(e.target.value.toUpperCase())} maxLength={6} autoCapitalize="characters" className="font-mono tracking-widest" />
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={passcode.length !== 6}>
              Ask to join
            </Button>
          </form>
        ) : view.kind === "employee-wait" || view.kind === "guest-wait" ? (
          <div className="space-y-3 text-center" role="status" aria-live="polite">
            <Clock className="mx-auto h-8 w-8 text-brand-600" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-ink-900">
              {view.kind === "guest-wait" && view.admitted ? "You're admitted" : "Waiting in the lobby"}
            </h1>
            <p className="text-sm text-ink-600">
              {view.kind === "guest-wait" && view.admitted
                ? "The meeting hasn't started yet. You'll join automatically when it does."
                : "The organizer has been told you're here. You'll join as soon as they let you in."}
            </p>
            {view.title ? <p className="text-sm font-medium text-ink-800">{view.title}</p> : null}
            <Spinner className="mx-auto h-5 w-5 text-ink-400" label="" />
            {view.kind === "guest-wait" ? (
              <button type="button" onClick={() => leaveAsGuest("You stopped waiting.")} className="text-sm text-ink-500 underline">
                Stop waiting
              </button>
            ) : null}
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void askAsGuest();
            }}
          >
            <div>
              <h1 className="text-lg font-semibold text-ink-900">Join as a guest</h1>
              <p className="mt-1 text-sm text-ink-600">For people without a Diwakar account. The organizer admits each guest.</p>
            </div>
            <FormError message={error} />
            <Field label="Your name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
            </Field>
            <Field label="Passcode">
              <Input value={passcode} onChange={(e) => setPasscode(e.target.value.toUpperCase())} maxLength={6} autoCapitalize="characters" className="font-mono tracking-widest" />
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!name.trim() || passcode.length !== 6}>
              Ask to join
            </Button>
            <p className="flex items-start gap-2 text-xs text-ink-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Guests see and hear the meeting only; chats and files stay private to employees.
            </p>
            <p className="border-t border-line pt-3 text-center text-sm text-ink-600">
              Diwakar employee?{" "}
              <Link href={`/sign-in?next=${encodeURIComponent(`/meet/${digits}${passcode ? `?p=${passcode}` : ""}`)}`} className="font-semibold text-brand-700 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
