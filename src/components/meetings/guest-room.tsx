"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DisconnectReason, Room, RoomEvent, Track, type Participant } from "livekit-client";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import clsx from "clsx";
import { AudioTrack, ParticipantTile } from "@/components/calls/participant-tile";

/**
 * Call view for an external guest (no Diwakar account). Media only: no chat,
 * whiteboard or moderation. The token is limited to this meeting's room.
 */
export function GuestRoom({ token, serverUrl, title, onLeft }: { token: string; serverUrl: string; title: string; onLeft: (message: string) => void }) {
  const roomRef = useRef<Room | null>(null);
  const [version, setVersion] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [status, setStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let left = false;
    room
      .on(RoomEvent.ParticipantConnected, bump)
      .on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.Reconnecting, () => setStatus("reconnecting"))
      .on(RoomEvent.Reconnected, () => setStatus("connected"))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (left) return;
        onLeft(
          reason === DisconnectReason.PARTICIPANT_REMOVED
            ? "The organizer removed you from the meeting."
            : reason === DisconnectReason.ROOM_DELETED
              ? "The meeting has ended."
              : "The connection to the meeting was lost.",
        );
      });
    void (async () => {
      try {
        await room.connect(serverUrl, token);
        setStatus("connected");
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => setMicOn(false));
        await room.localParticipant.setCameraEnabled(true).catch(() => setCamOn(false));
        bump();
      } catch {
        onLeft("Couldn't connect to the meeting. Check your network and try again.");
      }
    })();
    return () => {
      left = true;
      void room.disconnect();
    };
  }, [bump, onLeft, serverUrl, token]);

  async function toggle(kind: "mic" | "cam") {
    const room = roomRef.current;
    if (!room) return;
    try {
      if (kind === "mic") {
        await room.localParticipant.setMicrophoneEnabled(!micOn);
        setMicOn(!micOn);
      } else {
        await room.localParticipant.setCameraEnabled(!camOn);
        setCamOn(!camOn);
      }
    } catch {
      /* device unavailable */
    }
    bump();
  }

  const room = roomRef.current;
  void version;
  const participants: Participant[] = room ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())] : [];
  const n = participants.length;
  const audio = participants
    .filter((p) => p !== room?.localParticipant)
    .flatMap((p) => [Track.Source.Microphone, Track.Source.ScreenShareAudio].map((s) => p.getTrackPublication(s)?.track).filter((t): t is NonNullable<typeof t> => !!t));
  const screen = participants.find((p) => p.isScreenShareEnabled);

  return (
    <div className="flex h-dvh flex-col bg-ink-950 text-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="text-xs text-ink-300" role="status">
            {status === "connecting" ? "Connecting..." : status === "reconnecting" ? "Reconnecting..." : `${n} ${n === 1 ? "person" : "people"} · you're a guest`}
          </p>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {screen ? (
          <div className="flex h-full flex-col gap-3">
            <div className="flex shrink-0 gap-3 overflow-x-auto">
              {participants.map((p) => (
                <div key={p.identity} className="w-36 shrink-0">
                  <ParticipantTile participant={p} source={Track.Source.Camera} name={p.name || "Participant"} isLocal={p === room?.localParticipant} version={version} compact />
                </div>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              <ParticipantTile participant={screen} source={Track.Source.ScreenShare} name={screen.name || "Presenter"} isLocal={false} version={version} large />
            </div>
          </div>
        ) : (
          <div className={clsx("mx-auto grid h-full max-w-6xl content-center gap-3", n <= 1 ? "grid-cols-1" : n <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3")}>
            {participants.map((p) => (
              <ParticipantTile key={p.identity} participant={p} source={Track.Source.Camera} name={p.name || "Participant"} isLocal={p === room?.localParticipant} version={version} />
            ))}
          </div>
        )}
      </main>
      <footer className="flex shrink-0 items-center justify-center gap-3 pb-5 pt-2">
        <button type="button" onClick={() => void toggle("cam")} aria-label={camOn ? "Turn camera off" : "Turn camera on"} className={clsx("flex h-12 w-12 items-center justify-center rounded-full", camOn ? "bg-ink-700 hover:bg-ink-600" : "bg-danger-600")}>
          {camOn ? <Video className="h-5 w-5" aria-hidden="true" /> : <VideoOff className="h-5 w-5" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => void toggle("mic")} aria-label={micOn ? "Mute microphone" : "Unmute microphone"} className={clsx("flex h-12 w-12 items-center justify-center rounded-full", micOn ? "bg-ink-700 hover:bg-ink-600" : "bg-danger-600")}>
          {micOn ? <Mic className="h-5 w-5" aria-hidden="true" /> : <MicOff className="h-5 w-5" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => {
            void roomRef.current?.disconnect();
            onLeft("You left the meeting.");
          }}
          className="flex h-12 items-center gap-2 rounded-full bg-danger-600 px-5 text-sm font-semibold hover:bg-danger-700"
        >
          <PhoneOff className="h-5 w-5" aria-hidden="true" /> Leave
        </button>
      </footer>
      <div className="hidden" aria-hidden="true">
        {audio.map((t) => (
          <AudioTrack key={t.sid ?? t.mediaStreamTrack.id} track={t} sinkId={null} />
        ))}
      </div>
    </div>
  );
}
