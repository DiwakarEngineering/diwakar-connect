"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Phone, Video } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { startRingtone, stopRingtone } from "@/lib/sounds";
import { initials } from "@/lib/format";
import { useSignedUrl } from "@/lib/storage";
import { BrandMark } from "@/components/brand-mark";
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

  async function decline() {
    if (!ring) return;
    const id = ring.callId;
    clear();
    const { error } = await getSupabaseBrowserClient().rpc("respond_to_call", { p_call_id: id, p_response: "declined" });
    if (error) push({ tone: "error", title: "Couldn't decline the call" });
  }

  function accept(media: "audio" | "video") {
    if (!ring) return;
    const r = ring;
    clear();
    router.push(`/call/${r.conversationId}?media=${media}&answer=1`);
  }

  if (!ring) return null;
  return <RingCard ring={ring} caller={ring.callerId ? people.get(ring.callerId) : undefined} onAccept={accept} onDecline={() => void decline()} />;
}

/**
 * The ringing card: bottom-right on computers (above the bottom bar on phones), the caller's
 * photo blurred behind, "<name> is calling you", and round buttons to answer with video,
 * answer with audio only, or decline.
 */
function RingCard({
  ring,
  caller,
  onAccept,
  onDecline,
}: {
  ring: Ring;
  caller: { display_name: string; avatar_path: string | null; title: string | null } | undefined;
  onAccept: (media: "audio" | "video") => void;
  onDecline: () => void;
}) {
  const url = useSignedUrl("avatars", caller?.avatar_path, 3600);
  const name = caller?.display_name ?? "A colleague";
  const video = ring.media === "video";
  const round = "flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="incoming-call-title"
      aria-describedby="incoming-call-desc"
      className="fixed inset-x-3 bottom-20 z-[90] mx-auto w-auto max-w-[340px] animate-slide-up overflow-hidden rounded-2xl text-white shadow-pop ring-1 ring-white/10 md:inset-x-auto md:bottom-5 md:right-5 md:w-[340px]"
    >
      {/* Blurred caller photo (or big initials) behind everything. */}
      <div className="absolute inset-0 bg-ink-900" aria-hidden="true">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived
          <img src={url} alt="" className="h-full w-full scale-125 object-cover opacity-60 blur-2xl" />
        ) : (
          <span className="flex h-full w-full select-none items-center justify-center text-[180px] font-bold leading-none text-white/25 blur-md">
            {initials(name)}
          </span>
        )}
        <span className="absolute inset-0 bg-ink-950/45" />
      </div>

      <div className="relative flex flex-col items-center px-5 pb-5 pt-4 text-center">
        <p className="flex items-center gap-2 text-sm font-medium text-white/90">
          <BrandMark className="h-5 w-5" />
          <span id="incoming-call-title" className="min-w-0 truncate">
            <span className="font-semibold text-white">{name}</span> is calling you
          </span>
        </p>
        <p id="incoming-call-desc" className="mt-0.5 truncate text-xs text-white/70">
          {video ? "Video call" : "Audio call"}
          {ring.label ? ` · in ${ring.label}` : caller?.title ? ` · ${caller.title}` : ""}
        </p>

        <span className="relative mt-4">
          <span className="absolute inset-0 rounded-full bg-white/30 motion-safe:animate-ping" aria-hidden="true" />
          <span className="relative block rounded-full ring-4 ring-white/80">
            <Avatar name={name} path={caller?.avatar_path} userId={ring.callerId ?? undefined} size="xl" />
          </span>
        </span>

        <div className="mt-5 flex items-center justify-center gap-6">
          {video ? (
            <button type="button" onClick={() => onAccept("video")} aria-label="Accept with video" title="Accept with video" className={`${round} bg-brand-600 hover:bg-brand-700`}>
              <Video className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onAccept("audio")}
            aria-label={video ? "Accept with audio only" : "Accept"}
            title={video ? "Accept with audio only" : "Accept"}
            className={`${round} bg-brand-600 hover:bg-brand-700`}
          >
            <Phone className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={onDecline} aria-label="Decline" title="Decline" className={`${round} bg-danger-600 hover:bg-danger-700`}>
            <Phone className="h-5 w-5 rotate-[135deg]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
