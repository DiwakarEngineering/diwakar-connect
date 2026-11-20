"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  ConnectionState,
  DisconnectReason,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalVideoTrack,
  type Participant,
} from "livekit-client";
import {
  ArrowLeft,
  ChevronDown,
  Hand,
  LayoutGrid,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Settings,
  SmilePlus,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { usePresence } from "@/components/providers/presence-provider";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useConversationMeta } from "@/components/conversation/use-conversation-meta";
import { readApiError } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/env";
import { useCallConfig } from "./use-call-config";
import { AudioTrack, ParticipantTile, VideoElement } from "./participant-tile";
import { MeetingChat } from "./meeting-chat";
import { OutgoingRing, ParticipantsPanel, handRaised, useMeetingLobby, useRings } from "./meeting-panels";
import { Menu } from "@/components/ui/menu";
import { startRingback, stopRingtone } from "@/lib/sounds";
import { ShareDrawer, isPdf } from "./share-drawer";
import { Presentation } from "./presentation";
import { Whiteboard } from "./whiteboard";
import { readPresenterMode, readShare, setPresenterMode, setShare, type PresenterMode } from "./stage";
import { sendMessageTo } from "@/components/conversation/send-message";
import type { Tables } from "@/lib/database.types";
import { describeMediaError, supportsOutputSelection, supportsScreenShare } from "./media-errors";

type Phase =
  | { kind: "lobby" }
  | { kind: "joining" }
  | { kind: "connected" }
  | { kind: "reconnecting" }
  | { kind: "ended"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "error"; message: string };

const REACTIONS = ["👍", "❤️", "😂", "👏", "🎉", "😮"];

type CallInfo = { id: string; conversationId: string; media: "audio" | "video"; startedAt: string; startedBy: string | null };
type Devices = { audioinput: MediaDeviceInfo[]; videoinput: MediaDeviceInfo[]; audiooutput: MediaDeviceInfo[] };

const DISCONNECT_MESSAGES: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.ROOM_DELETED]: "The call was ended for everyone.",
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the call.",
  [DisconnectReason.DUPLICATE_IDENTITY]: "You joined this call from another tab or device.",
  [DisconnectReason.SERVER_SHUTDOWN]: "The call service restarted. Please rejoin.",
};

function sendLeaveBeacon(callId: string) {
  try {
    const blob = new Blob([JSON.stringify({ callId })], { type: "application/json" });
    navigator.sendBeacon("/api/calls/leave", blob);
  } catch {
    // Best effort; the LiveKit webhook and stale-call cleanup cover this case.
  }
}

function useElapsed(startedAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return "";
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallRoom({ conversationId, initialMedia }: { conversationId: string; initialMedia: "audio" | "video" }) {
  const router = useRouter();
  const { session, isAdmin } = useSession();
  const { push } = useToast();
  const config = useCallConfig();
  const { state: metaState } = useConversationMeta(conversationId);
  const meta = metaState.status === "ready" ? metaState.meta : null;

  const [phase, setPhase] = useState<Phase>({ kind: "lobby" });
  const { setMyActivity } = usePresence();
  const inCall = phase.kind === "connected" || phase.kind === "reconnecting";
  // Everyone sees "In a call" while this device is connected (cleared on leave, close or disconnect).
  useEffect(() => {
    setMyActivity(inCall ? "call" : null);
    return () => setMyActivity(null);
  }, [inCall, setMyActivity]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(initialMedia === "video");
  const [preview, setPreview] = useState<LocalVideoTrack | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Devices>({ audioinput: [], videoinput: [], audiooutput: [] });
  const [selected, setSelected] = useState<{ audioinput: string; videoinput: string; audiooutput: string }>({
    audioinput: "",
    videoinput: "",
    audiooutput: "",
  });
  const [version, setVersion] = useState(0);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitees, setInvitees] = useState<PickedPerson[]>([]);
  const [inviting, setInviting] = useState(false);
  const [busyControl, setBusyControl] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const callRef = useRef<CallInfo | null>(null);
  const leavingRef = useRef(false);
  const [call, setCall] = useState<CallInfo | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [layout, setLayout] = useState<"gallery" | "speaker">("gallery");
  const [reactions, setReactions] = useState<{ id: string; identity: string; emoji: string }[]>([]);
  const [reactOpen, setReactOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [someoneJoined, setSomeoneJoined] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const stoppingScreen = useRef(false);
  const rings = useRings(call?.id ?? null);
  const lobby = useMeetingLobby(conversationId);
  const elapsed = useElapsed(phase.kind === "connected" || phase.kind === "reconnecting" ? (call?.startedAt ?? null) : null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Pre-join: if the provider isn't configured, say so instead of offering to join.
  useEffect(() => {
    if (config.status !== "ready" || phase.kind !== "lobby") return;
    if (!config.providerConfigured) {
      setPhase({
        kind: "unconfigured",
        message: isDemoMode()
          ? "Calls need a LiveKit media server, so they aren't available in the local preview. Everything else works."
          : "Calling isn't set up yet. An administrator needs to add LiveKit credentials to the server.",
      });
    } else if (!config.enabledByOrganization) {
      setPhase({ kind: "unconfigured", message: "Calls are turned off for your organization." });
    }
  }, [config, phase.kind]);

  const refreshDevices = useCallback(async () => {
    try {
      const [audioinput, videoinput, audiooutput] = await Promise.all([
        Room.getLocalDevices("audioinput", false),
        Room.getLocalDevices("videoinput", false),
        supportsOutputSelection() ? Room.getLocalDevices("audiooutput", false) : Promise.resolve([]),
      ]);
      setDevices({ audioinput, videoinput, audiooutput });
    } catch {
      // Device enumeration is unavailable (e.g. insecure context).
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", refreshDevices);
    return () => md?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);

  // Camera preview in the lobby.
  useEffect(() => {
    if (phase.kind !== "lobby" || !camOn) return;
    let track: LocalVideoTrack | null = null;
    let cancelled = false;
    setPreviewError(null);
    createLocalVideoTrack({ deviceId: selected.videoinput || undefined, resolution: VideoPresets.h540.resolution })
      .then((t) => {
        if (cancelled) {
          t.stop();
          return;
        }
        track = t;
        setPreview(t);
        void refreshDevices();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreviewError(describeMediaError(e, "camera"));
        setCamOn(false);
      });
    return () => {
      cancelled = true;
      track?.stop();
      setPreview(null);
    };
  }, [camOn, phase.kind, refreshDevices, selected.videoinput]);

  const leaveServer = useCallback(async (callId: string) => {
    try {
      await fetch("/api/calls/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId }),
        keepalive: true,
      });
    } catch {
      sendLeaveBeacon(callId);
    }
  }, []);

  // Disconnect on unmount / tab close.
  useEffect(() => {
    const onUnload = () => {
      if (callRef.current && roomRef.current) sendLeaveBeacon(callRef.current.id);
    };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      const room = roomRef.current;
      if (room) {
        leavingRef.current = true;
        void room.disconnect();
        if (callRef.current) sendLeaveBeacon(callRef.current.id);
      }
    };
  }, []);

  const addReaction = useCallback((identity: string, emoji: string) => {
    const id = `${identity}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setReactions((list) => [...list.slice(-20), { id, identity, emoji }]);
    window.setTimeout(() => setReactions((list) => list.filter((r) => r.id !== id)), 3500);
  }, []);

  async function sendReaction(emoji: string) {
    setReactOpen(false);
    const room = roomRef.current;
    if (!room) return;
    addReaction(room.localParticipant.identity, emoji);
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ emoji })), { reliable: true, topic: "reactions" });
    } catch {
      push({ tone: "error", title: "Reaction not sent" });
    }
  }

  async function toggleHand() {
    const room = roomRef.current;
    if (!room) return;
    const up = handRaised(room.localParticipant);
    try {
      await room.localParticipant.setAttributes({ hand: up ? "" : "up" });
    } catch {
      push({ tone: "error", title: up ? "Couldn't lower your hand" : "Couldn't raise your hand" });
    }
    bump();
  }

  async function moderate(action: "mute" | "remove" | "mute_all" | "stop_share", userId?: string) {
    if (!callRef.current) return;
    const res = await fetch("/api/calls/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: callRef.current.id, action, ...(userId ? { userId } : {}) }),
    });
    if (!res.ok) {
      push({ tone: "error", title: "Action failed", description: (await readApiError(res)).message });
      return;
    }
    const done = { remove: "Removed from the meeting", mute: "Muted", mute_all: "Everyone else is muted", stop_share: "Presenting stopped" } as const;
    push({ tone: "success", title: done[action] });
  }

  function copyLink() {
    const url = `${window.location.origin}/call/${conversationId}`;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => push({ tone: "success", title: "Meeting link copied", description: "Only people with access to this conversation can join." }))
      .catch(() => push({ tone: "error", title: "Couldn't copy the link" }));
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      push({ tone: "error", title: "Full screen isn't available here" });
    }
  }

  /** Stop whatever I'm presenting (screen, slides, whiteboard). */
  async function stopMyPresenting() {
    const room = roomRef.current;
    if (!room) return;
    if (room.localParticipant.isScreenShareEnabled) {
      stoppingScreen.current = true;
      await room.localParticipant.setScreenShareEnabled(false).catch(() => undefined);
    }
    if (readShare(room.localParticipant)) await setShare(room.localParticipant, null).catch(() => undefined);
    bump();
  }

  /** Organizer/admin taking over: stop the current presenter first (server-enforced). */
  async function clearStageFor(identity: string | null) {
    if (!identity || identity === roomRef.current?.localParticipant.identity) return;
    await moderate("stop_share", identity);
  }

  async function startScreen(opts: { audio: boolean; mode: PresenterMode }) {
    const room = roomRef.current;
    if (!room) return;
    setShareBusy(true);
    try {
      await clearStageFor(stagePresenterRef.current);
      if (readShare(room.localParticipant)) await setShare(room.localParticipant, null);
      await setPresenterMode(room.localParticipant, opts.mode);
      await room.localParticipant.setScreenShareEnabled(true, { audio: opts.audio, systemAudio: opts.audio ? "include" : "exclude" });
      setShareOpen(false);
    } catch (e) {
      const blocked = e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");
      push({
        tone: blocked ? "info" : "error",
        title: blocked ? "Screen sharing was cancelled" : "Couldn't share your screen",
        description: blocked ? "Nothing is being shared. If your browser blocked it, allow screen sharing for this site and try again." : describeMediaError(e, "screen"),
      });
    } finally {
      setShareBusy(false);
      bump();
    }
  }

  async function startShare(share: Parameters<typeof setShare>[1]) {
    const room = roomRef.current;
    if (!room || !share) return;
    setShareBusy(true);
    try {
      await clearStageFor(stagePresenterRef.current);
      if (room.localParticipant.isScreenShareEnabled) {
        stoppingScreen.current = true;
        await room.localParticipant.setScreenShareEnabled(false);
      }
      await setShare(room.localParticipant, share);
      setShareOpen(false);
    } catch {
      push({ tone: "error", title: "Couldn't start presenting" });
    } finally {
      setShareBusy(false);
      bump();
    }
  }

  async function presentFile(att: Tables<"attachments">) {
    if (isPdf(att)) return startShare({ kind: "pdf", path: att.object_path, name: att.file_name, page: 1, pages: 0 });
    setShareBusy(true);
    const res = await fetch("/api/files/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId: att.id }),
    });
    setShareBusy(false);
    if (!res.ok) {
      push({ tone: "error", title: "Can't present this file yet", description: (await readApiError(res)).message });
      return;
    }
    const { attachment } = (await res.json()) as { attachment: Tables<"attachments"> };
    await startShare({ kind: "pdf", path: attachment.object_path, name: att.file_name, page: 1, pages: 0 });
  }

  async function uploadAndPresent(file: File) {
    setShareBusy(true);
    try {
      // Saved to the conversation, so only its members can open it.
      const messageId = await sendMessageTo(conversationId, session.userId, { body: "", mentions: [], replyToId: null, files: [file] });
      const { data } = await getSupabaseBrowserClient().from("attachments").select("*").eq("message_id", messageId).maybeSingle();
      setShareBusy(false);
      if (data) await presentFile(data);
    } catch (e) {
      setShareBusy(false);
      push({ tone: "error", title: "Upload failed", description: e instanceof Error ? e.message : undefined });
    }
  }

  async function saveBoardToChat(png: Blob) {
    try {
      const file = new File([png], `Whiteboard ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".")}.png`, { type: "image/png" });
      await sendMessageTo(conversationId, session.userId, { body: "Whiteboard from the meeting", mentions: [], replyToId: null, files: [file] });
      push({ tone: "success", title: "Whiteboard saved to the chat" });
    } catch (e) {
      push({ tone: "error", title: "Couldn't save the whiteboard", description: e instanceof Error ? e.message : undefined });
    }
  }

  async function join() {
    setPhase({ kind: "joining" });
    let res: Response;
    try {
      res = isDemoMode()
        ? // Local preview with a LiveKit dev server (see README): no Supabase server in demo mode.
          await fetch("/api/demo/call-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identity: session.userId, name: session.profile.display_name, conversationId, media: camOn ? "video" : "audio" }),
          })
        : await fetch("/api/calls/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId, media: camOn ? "video" : "audio" }),
          });
    } catch {
      setPhase({ kind: "error", message: "Can't reach the server. Check your connection and try again." });
      return;
    }
    if (!res.ok) {
      const err = await readApiError(res);
      setPhase(err.code === "not_configured" ? { kind: "unconfigured", message: err.message } : { kind: "error", message: err.message });
      return;
    }
    const { token, serverUrl, call: info } = (await res.json()) as { token: string; serverUrl: string; call: CallInfo };
    callRef.current = info;
    setCall(info);
    preview?.stop();

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { deviceId: selected.audioinput || undefined, echoCancellation: true, noiseSuppression: true },
      videoCaptureDefaults: { deviceId: selected.videoinput || undefined, resolution: VideoPresets.h720.resolution },
    });
    roomRef.current = room;
    leavingRef.current = false;

    room
      .on(RoomEvent.ParticipantConnected, bump)
      .on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.ParticipantAttributesChanged, bump)
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare && !stoppingScreen.current) {
          push({ tone: "info", title: "Screen sharing ended", description: "Sharing stopped from the browser or the shared window closed." });
        }
        stoppingScreen.current = false;
      })
      .on(RoomEvent.ConnectionQualityChanged, bump)
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
        if (topic !== "reactions" || !participant) return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as { emoji?: string };
          if (msg.emoji && REACTIONS.includes(msg.emoji)) addReaction(participant.identity, msg.emoji);
        } catch {
          // Ignore malformed data messages.
        }
      })
      .on(RoomEvent.Reconnecting, () => setPhase({ kind: "reconnecting" }))
      .on(RoomEvent.SignalReconnecting, () => setPhase({ kind: "reconnecting" }))
      .on(RoomEvent.Reconnected, () => setPhase({ kind: "connected" }))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setCanPlayAudio(room.canPlaybackAudio))
      .on(RoomEvent.MediaDevicesError, (e: Error) => push({ tone: "error", title: describeMediaError(e) }))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        roomRef.current = null;
        if (leavingRef.current) return;
        if (callRef.current) void leaveServer(callRef.current.id);
        setPhase({
          kind: "ended",
          message: (reason !== undefined && DISCONNECT_MESSAGES[reason]) || "The connection to the call was lost.",
        });
      });

    try {
      await room.connect(serverUrl, token);
    } catch {
      roomRef.current = null;
      await leaveServer(info.id);
      setPhase({ kind: "error", message: "Couldn't connect to the call service. Check your network or firewall and try again." });
      return;
    }

    setCanPlayAudio(room.canPlaybackAudio);
    setPhase({ kind: room.state === ConnectionState.Connected ? "connected" : "reconnecting" });

    if (micOn) {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (e) {
        setMicOn(false);
        push({ tone: "error", title: "Microphone unavailable", description: describeMediaError(e, "microphone") });
      }
    }
    if (camOn) {
      try {
        await room.localParticipant.setCameraEnabled(true);
      } catch (e) {
        setCamOn(false);
        push({ tone: "error", title: "Camera unavailable", description: describeMediaError(e, "camera") });
      }
    }
    if (selected.audiooutput) void room.switchActiveDevice("audiooutput", selected.audiooutput).catch(() => undefined);
    bump();
  }

  async function leave() {
    const room = roomRef.current;
    leavingRef.current = true;
    if (room) await room.disconnect();
    roomRef.current = null;
    if (callRef.current) await leaveServer(callRef.current.id);
    setPhase({ kind: "ended", message: "You left the call." });
  }

  async function endForAll() {
    if (!callRef.current) return;
    setBusyControl("end");
    const res = await fetch("/api/calls/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: callRef.current.id }),
    });
    setBusyControl(null);
    if (!res.ok) {
      push({ tone: "error", title: "Couldn't end the call", description: (await readApiError(res)).message });
      return;
    }
    leavingRef.current = true;
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setPhase({ kind: "ended", message: "You ended the call for everyone." });
  }

  async function toggle(kind: "mic" | "camera" | "screen") {
    const room = roomRef.current;
    if (!room) return;
    setBusyControl(kind);
    try {
      if (kind === "mic") {
        await room.localParticipant.setMicrophoneEnabled(!micOn);
        setMicOn(!micOn);
      } else if (kind === "camera") {
        await room.localParticipant.setCameraEnabled(!camOn);
        setCamOn(!camOn);
      } else {
        await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, { audio: true });
      }
    } catch (e) {
      // Cancelling the browser's screen picker is not an error worth shouting about.
      if (!(kind === "screen" && e instanceof Error && e.name === "NotAllowedError")) {
        push({
          tone: "error",
          title: kind === "screen" ? "Couldn't share your screen" : `Couldn't turn ${kind === "mic" ? "the microphone" : "the camera"} on`,
          description: describeMediaError(e, kind === "screen" ? "screen" : kind === "mic" ? "microphone" : "camera"),
        });
      }
    } finally {
      setBusyControl(null);
      bump();
    }
  }

  async function changeDevice(kind: keyof Devices, deviceId: string) {
    setSelected((s) => ({ ...s, [kind]: deviceId }));
    const room = roomRef.current;
    if (!room || !deviceId) return;
    const ok = await room.switchActiveDevice(kind, deviceId).catch(() => false);
    if (!ok) push({ tone: "error", title: "Couldn't switch device" });
  }

  async function sendInvites() {
    if (!callRef.current || invitees.length === 0) return;
    setInviting(true);
    const res = await fetch("/api/calls/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: callRef.current.id, userIds: invitees.map((p) => p.id) }),
    });
    setInviting(false);
    if (!res.ok) {
      push({ tone: "error", title: "Invite not sent", description: (await readApiError(res)).message });
      return;
    }
    const body = (await res.json()) as { invited: number; skipped: number };
    push({
      tone: "success",
      title: body.invited === 1 ? "1 person invited" : `${body.invited} people invited`,
      description: body.skipped ? `${body.skipped} couldn't be invited because they don't have access to this conversation.` : undefined,
    });
    setInvitees([]);
    setInviteOpen(false);
  }

  // --- Derived view state ---------------------------------------------------
  const room = roomRef.current;
  const participants: Participant[] = useMemo(() => {
    void version;
    if (!room) return [];
    return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  }, [room, version]);
  const people = usePeopleById([...participants.map((p) => p.identity), ...rings.map((r) => r.user_id), ...lobby.waiting.map((l) => l.user_id)]);
  const nameOf = (p: Participant) => people.get(p.identity)?.display_name ?? (p.name || "Guest");
  const screenSharer = participants.find((p) => p.isScreenShareEnabled);
  // The stage: a screen share wins over slides, which win over a whiteboard.
  const pdfPresenter = participants.find((p) => readShare(p)?.kind === "pdf");
  const boardOwner = participants.find((p) => readShare(p)?.kind === "board");
  const stagePresenter = screenSharer ?? pdfPresenter ?? boardOwner ?? null;
  const stagePresenterRef = useRef<string | null>(null);
  useEffect(() => {
    stagePresenterRef.current = stagePresenter?.identity ?? null;
  }, [stagePresenter]);
  const canEndForAll = !!call && (call.startedBy === session.userId || isAdmin);
  const title = meta?.title ?? "Call";
  const backHref =
    meta?.kind === "channel" && meta.team && meta.channel ? `/teams/${meta.team.id}/${meta.channel.id}` : `/chat/${conversationId}`;

  // Track whether anyone else has ever joined (outgoing-ring screen until then).
  const remoteCount = participants.length - (room ? 1 : 0);
  useEffect(() => {
    if (remoteCount > 0) setSomeoneJoined(true);
  }, [remoteCount]);
  const showRinging = inCall && !someoneJoined && remoteCount === 0 && call?.startedBy === session.userId && rings.length > 0;
  const stillRinging = showRinging && rings.some((r) => r.status === "ringing");
  useEffect(() => {
    if (!stillRinging) return;
    startRingback();
    return () => stopRingtone();
  }, [stillRinging]);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Accepting an incoming call (?answer=1) joins straight away.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current || phase.kind !== "lobby" || config.status !== "ready" || !config.providerConfigured || !meta?.canPost) return;
    if (new URLSearchParams(window.location.search).get("answer") !== "1") return;
    autoJoined.current = true;
    void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join reads current state; runs once
  }, [config, meta?.canPost, phase.kind]);

  // --- Non-room states ------------------------------------------------------
  if (phase.kind === "unconfigured" || phase.kind === "error" || phase.kind === "ended") {
    const icon = phase.kind === "ended" ? PhoneOff : WifiOff;
    const Icon = icon;
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 text-white">
        <div className="w-full max-w-md rounded-2xl bg-ink-900 p-6 text-center shadow-pop">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ink-800 text-brand-300">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-lg font-semibold">
            {phase.kind === "ended" ? "Call ended" : phase.kind === "unconfigured" ? "Calling unavailable" : "Couldn't join the call"}
          </h1>
          <p className="mt-2 text-sm text-ink-300" role="status">
            {phase.message}
          </p>
          {phase.kind === "unconfigured" && isAdmin ? (
            <p className="mt-3 rounded-lg bg-ink-800 p-3 text-left text-xs text-ink-300">
              Admins: set <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code> and <code>LIVEKIT_API_SECRET</code> on the server and redeploy.
              Chat and everything else keep working without it.
            </p>
          ) : null}
          <div className="mt-6 flex justify-center gap-2">
            <Link href={backHref} className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-ink-900 hover:bg-ink-100">
              Back to conversation
            </Link>
            {phase.kind !== "unconfigured" ? (
              <Button variant="primary" onClick={() => setPhase({ kind: "lobby" })}>
                {phase.kind === "ended" ? "Rejoin" : "Try again"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "lobby" || phase.kind === "joining") {
    const ready = config.status === "ready";
    return (
      <div className="flex min-h-dvh flex-col text-white">
        <header className="flex h-14 items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => router.push(backHref)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-300 hover:bg-ink-800 hover:text-white"
            aria-label="Back to conversation"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </header>
        <main id="main" className="flex flex-1 items-center justify-center px-4 pb-10">
          <div className="grid w-full max-w-4xl items-center gap-8 md:grid-cols-[1.4fr_1fr]">
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink-800">
              {preview && camOn ? (
                <VideoElement track={preview} mirror />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                  <Avatar name={session.profile.display_name} path={session.profile.avatar_path} userId={session.userId} size="xl" />
                  <span className="text-sm text-ink-300">{camOn ? "Starting camera..." : "Camera is off"}</span>
                </div>
              )}
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
                <button
                  type="button"
                  onClick={() => setMicOn((v) => !v)}
                  aria-pressed={micOn}
                  aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                  className={clsx("flex h-11 w-11 items-center justify-center rounded-full", micOn ? "bg-ink-700 hover:bg-ink-600" : "bg-danger-600")}
                >
                  {micOn ? <Mic className="h-5 w-5" aria-hidden="true" /> : <MicOff className="h-5 w-5" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={() => setCamOn((v) => !v)}
                  aria-pressed={camOn}
                  aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                  className={clsx("flex h-11 w-11 items-center justify-center rounded-full", camOn ? "bg-ink-700 hover:bg-ink-600" : "bg-danger-600")}
                >
                  {camOn ? <Video className="h-5 w-5" aria-hidden="true" /> : <VideoOff className="h-5 w-5" aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-semibold">Ready to join?</h2>
              <p className="mt-1 text-sm text-ink-300">{title}</p>
              {previewError ? (
                <p role="alert" className="mt-4 rounded-lg bg-danger-600/15 p-3 text-sm text-danger-50">
                  {previewError} You can still join with audio only.
                </p>
              ) : null}
              <div className="mt-5 space-y-3 text-ink-900">
                <DeviceSelect label="Microphone" devices={devices.audioinput} value={selected.audioinput} onChange={(v) => void changeDevice("audioinput", v)} />
                <DeviceSelect label="Camera" devices={devices.videoinput} value={selected.videoinput} onChange={(v) => void changeDevice("videoinput", v)} />
                {supportsOutputSelection() ? (
                  <DeviceSelect label="Speaker" devices={devices.audiooutput} value={selected.audiooutput} onChange={(v) => void changeDevice("audiooutput", v)} />
                ) : null}
              </div>
              <Button
                variant="primary"
                size="lg"
                className="mt-6 w-full"
                loading={phase.kind === "joining" || !ready}
                disabled={!meta?.canPost}
                onClick={() => void join()}
              >
                {phase.kind === "joining" ? "Joining..." : "Join now"}
              </Button>
              {meta && !meta.canPost ? <p className="mt-2 text-sm text-ink-300">You can&apos;t start a call in this conversation.</p> : null}
              <p className="mt-3 text-xs text-ink-400">Calls are not recorded.</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- In call ---------------------------------------------------------------
  const remoteAudio = participants
    .filter((p) => p !== room?.localParticipant)
    .flatMap((p) =>
      [Track.Source.Microphone, Track.Source.ScreenShareAudio]
        .map((s) => p.getTrackPublication(s)?.track)
        .filter((t): t is NonNullable<typeof t> => !!t),
    );
  const reactionsFor = (identity: string) => reactions.filter((r) => r.identity === identity);
  const local = room?.localParticipant;
  const canModerateStage = !!call && (call.startedBy === session.userId || isAdmin);
  const myHand = !!local && handRaised(local);
  const iPresent = !!local && stagePresenter === local;
  const othersPresenting = !!stagePresenter && stagePresenter !== local;
  const shareBlocked = othersPresenting && !canModerateStage ? `${nameOf(stagePresenter!)} is presenting. Ask them to stop, or the organizer can take over.` : null;
  const pmode = screenSharer ? readPresenterMode(screenSharer) : "content";
  const pdfShare = pdfPresenter ? readShare(pdfPresenter) : null;
  // Speaker view: the most recent active speaker (not me if possible), else the first other person.
  const speakerOrder = room?.activeSpeakers ?? [];
  const featured =
    speakerOrder.find((p) => p !== local) ?? participants.find((p) => p !== local) ?? local ?? null;
  const n = participants.length;
  const gridCols = n <= 1 ? "grid-cols-1" : n <= 4 ? "grid-cols-1 sm:grid-cols-2" : n <= 9 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4";
  const tile = (p: Participant, opts: { compact?: boolean; large?: boolean } = {}) => (
    <ParticipantTile
      key={p.identity}
      participant={p}
      source={Track.Source.Camera}
      name={nameOf(p)}
      avatarPath={people.get(p.identity)?.avatar_path}
      isLocal={p === local}
      version={version}
      reactions={reactionsFor(p.identity)}
      {...opts}
    />
  );
  const canModerate = canModerateStage;
  const tb = (active?: boolean) =>
    clsx(
      "flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm font-medium transition-colors",
      active ? "bg-brand-500/20 text-brand-300" : "text-ink-200 hover:bg-ink-800 hover:text-white",
    );
  const moreItems = [
    {
      label: layout === "gallery" ? "Speaker view" : "Gallery view",
      icon: <LayoutGrid className="h-4 w-4" />,
      onSelect: () => setLayout((l) => (l === "gallery" ? "speaker" : "gallery")),
    },
    { label: "Device settings", icon: <Settings className="h-4 w-4" />, onSelect: () => setSettingsOpen(true) },
    { label: fullscreen ? "Exit full screen" : "Full screen", icon: fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />, onSelect: () => void toggleFullscreen() },
    ...(meta?.kind !== "direct" ? [{ label: "Invite people", icon: <UserPlus className="h-4 w-4" />, onSelect: () => setInviteOpen(true) }] : []),
    ...(canEndForAll
      ? [{ type: "separator" as const }, { label: "End meeting for everyone", icon: <PhoneOff className="h-4 w-4" />, danger: true, onSelect: () => void endForAll() }]
      : []),
  ];

  const mediaControls = (
    <>
      <ControlButton
        label={camOn ? "Turn camera off" : "Turn camera on"}
        active={camOn}
        busy={busyControl === "camera"}
        onClick={() => void toggle("camera")}
        icon={camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
      />
      <ControlButton
        label={micOn ? "Mute microphone" : "Unmute microphone"}
        active={micOn}
        busy={busyControl === "mic"}
        onClick={() => void toggle("mic")}
        icon={micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      />
      <ControlButton
        label={iPresent ? "Stop presenting" : "Share content"}
        active={!iPresent}
        highlight={iPresent || shareOpen}
        busy={shareBusy}
        onClick={() => {
          if (iPresent) void stopMyPresenting();
          else {
            setShareOpen((v) => !v);
            setPanelOpen(false);
            setChatOpen(false);
          }
        }}
        icon={<MonitorUp className="h-5 w-5" />}
        className="hidden sm:flex"
      />
    </>
  );

  return (
    <div className="flex h-dvh flex-col bg-ink-950 text-white">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-white/5 px-3 md:px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="text-xs text-ink-300" role="status" aria-live="polite">
            {phase.kind === "reconnecting" ? (
              <span className="inline-flex items-center gap-1.5 text-brand-300">
                <Spinner className="h-3 w-3" label="" /> Network interrupted. Reconnecting...
              </span>
            ) : (
              <>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-success-600" aria-hidden="true" />
                <span className="tabular-nums">{elapsed}</span> · {n} {n === 1 ? "person" : "people"}
              </>
            )}
          </p>
        </div>

        <nav aria-label="Meeting tools" className="flex items-center gap-0.5">
          <button type="button" onClick={() => { setPanelOpen((v) => !v); setChatOpen(false); setShareOpen(false); }} aria-pressed={panelOpen} className={tb(panelOpen)} title="Participants" aria-label={`Participants (${n})`}>
            <Users className="h-5 w-5" aria-hidden="true" />
            <span className="hidden text-xs md:inline" aria-hidden="true">{n}</span>
          </button>
          {meta ? (
            <button type="button" onClick={() => { setChatOpen((v) => !v); setPanelOpen(false); setShareOpen(false); }} aria-pressed={chatOpen} className={tb(chatOpen)} title="Meeting chat" aria-label="Meeting chat">
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" onClick={() => void toggleHand()} aria-pressed={myHand} className={clsx(tb(myHand), "hidden sm:flex")} title={myHand ? "Lower hand" : "Raise hand"} aria-label={myHand ? "Lower hand" : "Raise hand"}>
            <Hand className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="relative hidden sm:block">
            <button type="button" onClick={() => setReactOpen((v) => !v)} aria-expanded={reactOpen} aria-haspopup="true" className={tb(reactOpen)} title="React" aria-label="React">
              <SmilePlus className="h-5 w-5" aria-hidden="true" />
            </button>
            {reactOpen ? (
              <div role="menu" aria-label="Reactions" className="absolute right-0 top-full z-50 mt-2 flex gap-1 rounded-2xl bg-ink-800 p-1.5 shadow-pop ring-1 ring-white/10">
                {REACTIONS.map((e) => (
                  <button key={e} type="button" role="menuitem" onClick={() => void sendReaction(e)} className="flex h-10 w-10 items-center justify-center rounded-xl text-2xl hover:bg-ink-700" aria-label={`React ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Menu label="More options" items={moreItems} trigger={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />} triggerClassName={tb(false)} />
          <span className="mx-1 hidden h-6 w-px bg-white/10 md:block" aria-hidden="true" />
          <div className="hidden items-center gap-1.5 md:flex">{mediaControls}</div>
          <button
            type="button"
            onClick={() => void leave()}
            className="ml-1 hidden h-10 items-center gap-2 rounded-xl bg-danger-600 px-4 text-sm font-semibold hover:bg-danger-700 md:flex"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            Leave
          </button>
          {canEndForAll ? (
            <Menu
              label="Leave options"
              items={[
                { label: "Leave (others stay)", icon: <PhoneOff className="h-4 w-4" />, onSelect: () => void leave() },
                { label: "End meeting for everyone", icon: <PhoneOff className="h-4 w-4" />, danger: true, onSelect: () => void endForAll() },
              ]}
              trigger={<ChevronDown className="h-4 w-4" aria-hidden="true" />}
              triggerClassName="-ml-1 hidden h-10 w-8 items-center justify-center rounded-r-xl bg-danger-600 hover:bg-danger-700 md:flex"
            />
          ) : null}
        </nav>
      </header>

      {!canPlayAudio ? (
        <div className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-xl bg-brand-600 px-4 py-2 text-sm">
          Your browser blocked call audio.
          <button type="button" onClick={() => void room?.startAudio()} className="rounded-lg bg-white px-3 py-1 font-semibold text-brand-700">
            <Volume2 className="mr-1 inline h-4 w-4" aria-hidden="true" />
            Enable audio
          </button>
        </div>
      ) : null}

      {lobby.waiting.length && !panelOpen ? (
        <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-xl bg-brand-600 px-4 py-2 text-sm text-white" role="alert">
          <span className="truncate">
            {lobby.waiting.length === 1
              ? `${lobby.waiting[0]!.guest_name ? `${lobby.waiting[0]!.guest_name} (guest)` : (people.get(lobby.waiting[0]!.user_id ?? "")?.display_name ?? "Someone")} is waiting in the lobby`
              : `${lobby.waiting.length} people are waiting in the lobby`}
          </span>
          <button type="button" onClick={() => { setPanelOpen(true); setChatOpen(false); setShareOpen(false); }} className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-brand-700">
            View lobby
          </button>
        </div>
      ) : null}

      {stagePresenter ? (
        <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-xl bg-brand-600/15 px-4 py-2 text-sm text-brand-100 ring-1 ring-brand-500/30" role="status">
          <span className="flex min-w-0 items-center gap-2">
            <MonitorUp className="h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />
            <span className="truncate">
              {iPresent
                ? screenSharer === local
                  ? "You're sharing your screen"
                  : `You're presenting ${pdfShare?.kind === "pdf" ? pdfShare.name : "the whiteboard"}`
                : `${nameOf(stagePresenter)} is presenting${screenSharer ? "" : pdfShare ? ` ${pdfShare.kind === "pdf" ? pdfShare.name : ""}` : " the whiteboard"}`}
            </span>
          </span>
          {iPresent ? (
            <button type="button" onClick={() => void stopMyPresenting()} className="shrink-0 rounded-lg bg-danger-600 px-3 py-1 text-xs font-semibold text-white hover:bg-danger-700">
              {screenSharer === local ? "Stop sharing" : "Stop presenting"}
            </button>
          ) : canModerateStage ? (
            <button type="button" onClick={() => void moderate("stop_share", stagePresenter.identity)} className="shrink-0 rounded-lg border border-brand-400/50 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600/30">
              Stop their presenting
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          {showRinging ? (
            <OutgoingRing rings={rings} people={people} onCancel={() => void (canEndForAll ? endForAll() : leave())} />
          ) : stagePresenter && room && local ? (
            <div className="flex h-full flex-col gap-3">
              {/* Everyone else moves to a strip; in side-by-side mode the presenter sits beside the content. */}
              <div className="flex shrink-0 gap-3 overflow-x-auto pb-1">
                {participants
                  .filter((p) => !(screenSharer && pmode !== "content" && p === screenSharer))
                  .map((p) => (
                    <div key={p.identity} className="w-36 shrink-0">
                      {tile(p, { compact: true })}
                    </div>
                  ))}
              </div>
              <div className={clsx("min-h-0 flex-1", screenSharer && pmode === "side" && "grid grid-cols-1 gap-3 lg:grid-cols-[3fr_1fr]")}>
                {screenSharer ? (
                  <div className="relative h-full min-h-0">
                    <ParticipantTile participant={screenSharer} source={Track.Source.ScreenShare} name={nameOf(screenSharer)} isLocal={screenSharer === local} version={version} large />
                    {pmode === "pip" ? <div className="absolute bottom-3 right-3 w-48 shadow-pop">{tile(screenSharer, { compact: true })}</div> : null}
                  </div>
                ) : pdfPresenter && pdfShare?.kind === "pdf" ? (
                  <Presentation
                    room={room}
                    me={local.identity}
                    presenter={pdfPresenter.identity}
                    share={pdfShare}
                    nameOf={(id) => people.get(id)?.display_name ?? "Participant"}
                    onStop={pdfPresenter === local ? () => void stopMyPresenting() : canModerateStage ? () => void moderate("stop_share", pdfPresenter.identity) : undefined}
                  />
                ) : boardOwner ? (
                  <Whiteboard
                    key={boardOwner.identity}
                    room={room}
                    me={local.identity}
                    owner={boardOwner.identity}
                    organizer={call?.startedBy ?? null}
                    canClear={boardOwner === local || canModerateStage}
                    nameOf={(id) => people.get(id)?.display_name ?? "Participant"}
                    onClose={boardOwner === local ? () => void stopMyPresenting() : canModerateStage ? () => void moderate("stop_share", boardOwner.identity) : undefined}
                    onSaveToChat={meta?.canPost ? saveBoardToChat : undefined}
                  />
                ) : null}
                {screenSharer && pmode === "side" ? <div className="hidden min-h-0 lg:block">{tile(screenSharer)}</div> : null}
              </div>
            </div>
          ) : layout === "speaker" && featured && n > 1 ? (
            <div className="flex h-full flex-col gap-3">
              <div className="flex shrink-0 gap-3 overflow-x-auto pb-1">
                {participants
                  .filter((p) => p !== featured)
                  .map((p) => (
                    <div key={p.identity} className="w-40 shrink-0">
                      {tile(p, { compact: true })}
                    </div>
                  ))}
              </div>
              <div className="min-h-0 flex-1">{tile(featured, { large: true })}</div>
            </div>
          ) : (
            <div className={clsx("mx-auto grid h-full max-w-7xl content-center gap-3", gridCols)}>
              {participants.map((p) => tile(p))}
              {n === 1 ? <p className="text-center text-sm text-ink-300">Waiting for others to join...</p> : null}
            </div>
          )}
        </main>

        {panelOpen && local ? (
          <ParticipantsPanel
            participants={participants}
            localIdentity={local.identity}
            organizerId={call?.startedBy ?? null}
            people={people}
            rings={rings}
            canModerate={canModerate}
            canInvite={meta?.kind !== "direct"}
            onInvite={() => setInviteOpen(true)}
            onCopyLink={copyLink}
            onMute={(id) => void moderate("mute", id)}
            onRemove={(id) => void moderate("remove", id)}
            onMuteAll={() => void moderate("mute_all")}
            lobby={lobby.waiting}
            onDecide={(l, admit) =>
              void lobby.decide(l, admit).then((e) => {
                if (e) push({ tone: "error", title: "Couldn't update the lobby", description: e.message });
              })
            }
            onClose={() => setPanelOpen(false)}
          />
        ) : chatOpen && meta ? (
          <MeetingChat meta={meta} onClose={() => setChatOpen(false)} />
        ) : shareOpen ? (
          <ShareDrawer
            conversationId={conversationId}
            audioSupported={supportsScreenShare() && /Chrome|Edg/.test(navigator.userAgent)}
            busy={shareBusy}
            blockedReason={shareBlocked}
            onScreen={(o) => void startScreen(o)}
            onWhiteboard={() => void startShare({ kind: "board", name: "Whiteboard" })}
            onPresent={(a) => void presentFile(a)}
            onUpload={(f) => void uploadAndPresent(f)}
            onClose={() => setShareOpen(false)}
          />
        ) : null}
      </div>

      {/* Phones and small tablets: media controls at the bottom, within thumb reach. */}
      <footer className="pb-safe flex shrink-0 items-center justify-center gap-2 px-3 pb-4 pt-1 md:hidden">
        {mediaControls}
        <ControlButton label={myHand ? "Lower hand" : "Raise hand"} active highlight={myHand} onClick={() => void toggleHand()} icon={<Hand className="h-5 w-5" />} />
        <button type="button" onClick={() => void leave()} className="flex h-12 items-center gap-2 rounded-full bg-danger-600 px-5 text-sm font-semibold hover:bg-danger-700">
          <PhoneOff className="h-5 w-5" aria-hidden="true" />
          Leave
        </button>
      </footer>

      <div className="hidden" aria-hidden="true">
        {remoteAudio.map((t) => (
          <AudioTrack key={t.sid ?? t.mediaStreamTrack.id} track={t} sinkId={selected.audiooutput || null} />
        ))}
      </div>

      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Audio & video devices"
        size="sm"
        footer={<Button onClick={() => setSettingsOpen(false)}>Done</Button>}
      >
        <div className="space-y-3">
          <DeviceSelect label="Microphone" devices={devices.audioinput} value={selected.audioinput} onChange={(v) => void changeDevice("audioinput", v)} />
          <DeviceSelect label="Camera" devices={devices.videoinput} value={selected.videoinput} onChange={(v) => void changeDevice("videoinput", v)} />
          {supportsOutputSelection() ? (
            <DeviceSelect label="Speaker" devices={devices.audiooutput} value={selected.audiooutput} onChange={(v) => void changeDevice("audiooutput", v)} />
          ) : (
            <p className="text-xs text-ink-500">Speaker selection isn&apos;t supported in this browser.</p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        busy={inviting}
        title="Invite to this call"
        description={
          meta?.kind === "direct"
            ? undefined
            : meta?.kind === "group"
              ? "Invitees are added to the group chat and notified."
              : "People need access to this channel to join."
        }
        footer={
          meta?.kind === "direct" ? (
            <Button onClick={() => setInviteOpen(false)}>Close</Button>
          ) : (
            <>
              <Button onClick={() => setInviteOpen(false)} disabled={inviting}>
                Cancel
              </Button>
              <Button variant="primary" loading={inviting} disabled={invitees.length === 0} onClick={() => void sendInvites()}>
                Send invite
              </Button>
            </>
          )
        }
      >
        {meta?.kind === "direct" ? (
          <p className="text-sm text-ink-600">
            Direct calls are between two people. To bring others in, start the call from a group chat or channel.
          </p>
        ) : (
          <PeoplePicker selected={invitees} onChange={setInvitees} excludeIds={participants.map((p) => p.identity)} max={20} />
        )}
      </Dialog>
    </div>
  );
}

function ControlButton({
  label,
  icon,
  active,
  highlight,
  busy,
  disabled,
  onClick,
  className,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  highlight?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      aria-label={label}
      title={label}
      className={clsx(
        "flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:opacity-50",
        highlight ? "bg-brand-500 text-white" : active ? "bg-ink-700 hover:bg-ink-600" : "bg-danger-600 hover:bg-danger-700",
        className,
      )}
    >
      {busy ? <Spinner className="h-5 w-5" label="" /> : <span aria-hidden="true">{icon}</span>}
    </button>
  );
}

function DeviceSelect({
  label,
  devices,
  value,
  onChange,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={devices.length === 0}>
        <option value="">{devices.length === 0 ? "No devices found (or permission needed)" : "System default"}</option>
        {devices
          .filter((d) => d.deviceId && d.deviceId !== "default")
          .map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
      </Select>
    </Field>
  );
}
