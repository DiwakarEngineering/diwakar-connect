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
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useConversationMeta } from "@/components/conversation/use-conversation-meta";
import { readApiError } from "@/lib/errors";
import { isDemoMode } from "@/lib/env";
import { useCallConfig } from "./use-call-config";
import { AudioTrack, ParticipantTile, VideoElement } from "./participant-tile";
import { describeMediaError, supportsOutputSelection, supportsScreenShare } from "./media-errors";

type Phase =
  | { kind: "lobby" }
  | { kind: "joining" }
  | { kind: "connected" }
  | { kind: "reconnecting" }
  | { kind: "ended"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "error"; message: string };

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

  async function join() {
    setPhase({ kind: "joining" });
    let res: Response;
    try {
      res = await fetch("/api/calls/token", {
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
  const people = usePeopleById(participants.map((p) => p.identity));
  const nameOf = (p: Participant) => people.get(p.identity)?.display_name ?? (p.name || "Guest");
  const screenSharer = participants.find((p) => p.isScreenShareEnabled);
  const isLocalSharing = !!room?.localParticipant.isScreenShareEnabled;
  const canEndForAll = !!call && (call.startedBy === session.userId || isAdmin);
  const title = meta?.title ?? "Call";
  const backHref =
    meta?.kind === "channel" && meta.team && meta.channel ? `/teams/${meta.team.id}/${meta.channel.id}` : `/chat/${conversationId}`;

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
  const gridCols =
    participants.length <= 1 ? "grid-cols-1" : participants.length <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3";

  return (
    <div className="flex h-dvh flex-col text-white">
      <header className="flex h-14 shrink-0 items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="text-xs text-ink-300" role="status" aria-live="polite">
            {phase.kind === "reconnecting" ? (
              <span className="inline-flex items-center gap-1.5 text-warning-50">
                <Spinner className="h-3 w-3" label="" /> Reconnecting...
              </span>
            ) : (
              <>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-success-600" aria-hidden="true" />
                Live · {elapsed} · {participants.length} {participants.length === 1 ? "person" : "people"}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-pressed={panelOpen}
          className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-ink-200 hover:bg-ink-800"
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Participants</span>
        </button>
      </header>

      {!canPlayAudio ? (
        <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-xl bg-brand-600 px-4 py-2 text-sm">
          Your browser blocked call audio.
          <button type="button" onClick={() => void room?.startAudio()} className="rounded-lg bg-white px-3 py-1 font-semibold text-brand-700">
            <Volume2 className="mr-1 inline h-4 w-4" aria-hidden="true" />
            Enable audio
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          {screenSharer ? (
            <div className="flex h-full flex-col gap-3">
              <div className="min-h-0 flex-1">
                <ParticipantTile
                  participant={screenSharer}
                  source={Track.Source.ScreenShare}
                  name={nameOf(screenSharer)}
                  isLocal={screenSharer === room?.localParticipant}
                  version={version}
                  large
                />
              </div>
              <div className="flex shrink-0 gap-3 overflow-x-auto">
                {participants.map((p) => (
                  <div key={p.identity} className="w-48 shrink-0">
                    <ParticipantTile
                      participant={p}
                      source={Track.Source.Camera}
                      name={nameOf(p)}
                      avatarPath={people.get(p.identity)?.avatar_path}
                      isLocal={p === room?.localParticipant}
                      version={version}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={clsx("mx-auto grid h-full max-w-6xl content-center gap-3", gridCols)}>
              {participants.map((p) => (
                <ParticipantTile
                  key={p.identity}
                  participant={p}
                  source={Track.Source.Camera}
                  name={nameOf(p)}
                  avatarPath={people.get(p.identity)?.avatar_path}
                  isLocal={p === room?.localParticipant}
                  version={version}
                />
              ))}
              {participants.length === 1 ? (
                <p className="text-center text-sm text-ink-300">Waiting for others to join...</p>
              ) : null}
            </div>
          )}
        </main>

        {panelOpen ? (
          <aside aria-label="Participants" className="fixed inset-0 z-40 flex flex-col bg-ink-900 md:static md:w-80 md:rounded-2xl">
            <div className="flex h-14 items-center justify-between border-b border-ink-700 px-4">
              <h2 className="text-sm font-semibold">Participants ({participants.length})</h2>
              <button type="button" onClick={() => setPanelOpen(false)} className="rounded-lg p-2 text-ink-300 hover:bg-ink-800" aria-label="Close participants">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto py-2">
              {participants.map((p) => (
                <li key={p.identity} className="flex items-center gap-3 px-4 py-2">
                  <Avatar name={nameOf(p)} path={people.get(p.identity)?.avatar_path} userId={p.identity} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {nameOf(p)}
                    {p === room?.localParticipant ? " (you)" : ""}
                  </span>
                  {p.isScreenShareEnabled ? <MonitorUp className="h-4 w-4 text-brand-300" aria-label="Sharing screen" /> : null}
                  {p.isMicrophoneEnabled ? <Mic className="h-4 w-4 text-ink-300" aria-label="Mic on" /> : <MicOff className="h-4 w-4 text-danger-50" aria-label="Muted" />}
                </li>
              ))}
            </ul>
            <div className="border-t border-ink-700 p-3">
              <Button className="w-full" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Invite people
              </Button>
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="pb-safe flex shrink-0 items-center justify-center gap-2 px-3 pb-4 pt-1 sm:gap-3">
        <ControlButton
          label={micOn ? "Mute" : "Unmute"}
          active={micOn}
          busy={busyControl === "mic"}
          onClick={() => void toggle("mic")}
          icon={micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        />
        <ControlButton
          label={camOn ? "Stop video" : "Start video"}
          active={camOn}
          busy={busyControl === "camera"}
          onClick={() => void toggle("camera")}
          icon={camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        />
        {supportsScreenShare() ? (
          <ControlButton
            label={isLocalSharing ? "Stop sharing" : "Share screen"}
            active={!isLocalSharing}
            highlight={isLocalSharing}
            busy={busyControl === "screen"}
            disabled={!!screenSharer && !isLocalSharing}
            onClick={() => void toggle("screen")}
            icon={<MonitorUp className="h-5 w-5" />}
            className="hidden sm:flex"
          />
        ) : null}
        <ControlButton label="Devices" active onClick={() => setSettingsOpen(true)} icon={<Settings className="h-5 w-5" />} />
        <ControlButton label="Invite" active onClick={() => setInviteOpen(true)} icon={<UserPlus className="h-5 w-5" />} className="hidden sm:flex" />
        <button
          type="button"
          onClick={() => void leave()}
          className="flex h-12 items-center gap-2 rounded-full bg-danger-600 px-5 text-sm font-semibold hover:bg-danger-700"
        >
          <PhoneOff className="h-5 w-5" aria-hidden="true" />
          Leave
        </button>
        {canEndForAll ? (
          <button
            type="button"
            onClick={() => void endForAll()}
            disabled={busyControl === "end"}
            className="hidden h-12 rounded-full border border-danger-600 px-4 text-sm font-semibold text-danger-50 hover:bg-danger-600/20 md:block"
          >
            End for all
          </button>
        ) : null}
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
