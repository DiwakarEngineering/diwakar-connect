"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Phone, PhoneOff, Video } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { startRingtone, stopRingtone } from "@/lib/sounds";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";

type Ring = {
  callId: string;
  conversationId: string;
  media: "audio" | "video";
  callerId: string | null;
  label: string | null;
};

const RING_FOR_MS = 45_000;

/**
 * Incoming-call popup on every page. Rings come from call_invites (created by
 * the database when a colleague starts a direct or group call, or invites you).
 * Accept joins the call; Decline tells the caller; no answer in 45 s records a
 * missed call. Do not disturb: no popup and no sound (it becomes a missed call).
 */
export function IncomingCall() {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useSession();
  const { push } = useToast();
  const me = session.userId;
  const [ring, setRing] = useState<Ring | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ pathname, dnd: false });
  useEffect(() => {
    live.current = { pathname, dnd: session.profile.availability === "do_not_disturb" };
  }, [pathname, session.profile.availability]);
  const people = usePeopleById([ring?.callerId]);

  const clear = useCallback(() => {
    stopRingtone();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRing(null);
  }, []);

  const show = useCallback(
    async (callId: string) => {
      if (live.current.dnd) return;
      const supabase = getSupabaseBrowserClient();
      const { data: call } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
      if (!call || call.status !== "active") return;
      // Already in this call (e.g. joined from another tab): don't ring.
      if (live.current.pathname === `/call/${call.conversation_id}`) return;
      const { data: conv } = await supabase.rpc("list_my_conversations", { p_limit: 300 });
      const row = (conv ?? []).find((c) => c.conversation_id === call.conversation_id);
      setRing({
        callId,
        conversationId: call.conversation_id,
        media: call.media,
        callerId: call.started_by,
        label: row && row.kind !== "direct" ? row.title : null,
      });
      startRingtone();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void supabase.rpc("respond_to_call", { p_call_id: callId, p_response: "missed" });
        clear();
      }, RING_FOR_MS);
    },
    [clear],
  );

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`rings:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_invites", filter: `user_id=eq.${me}` }, (p) => {
        const inv = p.new as Tables<"call_invites">;
        if (inv.status === "ringing") void show(inv.call_id);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "call_invites", filter: `user_id=eq.${me}` }, (p) => {
        const inv = p.new as Tables<"call_invites">;
        if (inv.status === "ringing") void show(inv.call_id);
        // Answered on another device, declined, or the call ended (missed): stop ringing.
        else setRing((cur) => (cur?.callId === inv.call_id ? (stopRingtone(), null) : cur));
      })
      .subscribe();
    // A ring that started just before this page loaded.
    void supabase
      .from("call_invites")
      .select("call_id, created_at")
      .eq("user_id", me)
      .eq("status", "ringing")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const latest = data?.[0];
        if (latest && Date.now() - new Date(latest.created_at).getTime() < RING_FOR_MS) void show(latest.call_id);
      });
    return () => {
      stopRingtone();
      void supabase.removeChannel(channel);
    };
  }, [me, show]);

  if (!ring) return null;
  const caller = ring.callerId ? people.get(ring.callerId) : undefined;
  const name = caller?.display_name ?? "A colleague";
  const video = ring.media === "video";

  async function decline() {
    if (!ring) return;
    const id = ring.callId;
    clear();
    const { error } = await getSupabaseBrowserClient().rpc("respond_to_call", { p_call_id: id, p_response: "declined" });
    if (error) push({ tone: "error", title: "Couldn't decline the call" });
  }

  function accept() {
    if (!ring) return;
    const r = ring;
    clear();
    router.push(`/call/${r.conversationId}?media=${r.media}&answer=1`);
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="incoming-call-title"
      aria-describedby="incoming-call-desc"
      className="fixed inset-x-3 top-3 z-[90] mx-auto max-w-sm animate-slide-up rounded-2xl bg-ink-900 p-4 text-white shadow-pop ring-1 ring-white/10 sm:inset-x-auto sm:right-4 sm:top-4"
    >
      <div className="flex items-center gap-3">
        <span className="rounded-full p-0.5 ring-2 ring-brand-500 motion-safe:animate-pulse">
          <Avatar name={name} path={caller?.avatar_path} userId={ring.callerId ?? undefined} size="lg" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-300">
            {video ? "Incoming video call" : "Incoming audio call"}
          </p>
          <p id="incoming-call-title" className="truncate text-base font-semibold">
            {name}
          </p>
          <p id="incoming-call-desc" className="truncate text-xs text-ink-300">
            {ring.label ? `in ${ring.label}` : caller?.title ?? "Diwakar Connect"}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void decline()}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-danger-600 text-sm font-semibold hover:bg-danger-700"
        >
          <PhoneOff className="h-4 w-4" aria-hidden="true" />
          Decline
        </button>
        <button
          type="button"
          autoFocus
          onClick={accept}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-success-600 text-sm font-semibold hover:bg-success-700"
        >
          {video ? <Video className="h-4 w-4" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
          Accept
        </button>
      </div>
    </div>
  );
}
