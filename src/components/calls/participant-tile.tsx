"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { ConnectionQuality, Track, type Participant, type Track as TrackType } from "livekit-client";
import { Hand, MicOff, MonitorUp, Wifi, WifiOff } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

type Props = {
  participant: Participant;
  source: Track.Source;
  name: string;
  avatarPath?: string | null;
  isLocal: boolean;
  /** Changes whenever LiveKit reports track/mute/speaking changes. */
  version: number;
  large?: boolean;
  /** Small thumbnail (speaker view strip). */
  compact?: boolean;
  /** Emoji reactions currently floating over this person. */
  reactions?: { id: string; emoji: string }[];
};

export function VideoElement({ track, mirror, contain }: { track: TrackType; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={clsx("h-full w-full", contain ? "object-contain" : "object-cover", mirror && "-scale-x-100")}
    />
  );
}

export function ParticipantTile({ participant, source, name, avatarPath, isLocal, version, large, compact, reactions = [] }: Props) {
  void version;
  const hand = participant.attributes?.hand === "up";
  const quality = participant.connectionQuality;
  const poor = quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;
  const pub = participant.getTrackPublication(source);
  const track = pub?.track;
  const showVideo = !!track && !pub?.isMuted;
  const micOn = participant.isMicrophoneEnabled;
  const isScreen = source === Track.Source.ScreenShare;

  return (
    <div
      className={clsx(
        "relative flex aspect-video items-center justify-center overflow-hidden bg-ink-800 transition-shadow",
        compact ? "rounded-xl ring-2" : "rounded-2xl ring-[3px]",
        participant.isSpeaking && !isScreen ? "ring-brand-500" : "ring-transparent",
        large && "h-full w-full",
      )}
    >
      {showVideo && track ? (
        <VideoElement track={track} mirror={isLocal && !isScreen} contain={isScreen} />
      ) : (
        <Avatar name={name} path={avatarPath} userId={participant.identity} size={compact ? "lg" : "xl"} />
      )}
      {hand && !isScreen ? (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-xs font-semibold text-white" aria-label="Hand raised">
          <Hand className="h-3.5 w-3.5" aria-hidden="true" />
          {compact ? null : "Hand raised"}
        </span>
      ) : null}
      {!isScreen && quality !== ConnectionQuality.Unknown ? (
        <span
          className={clsx("absolute right-2 top-2 rounded-md bg-ink-950/60 p-1", poor ? "text-brand-300" : "text-ink-200")}
          title={poor ? "Poor connection" : quality === ConnectionQuality.Excellent ? "Excellent connection" : "Good connection"}
        >
          {poor ? <WifiOff className="h-3.5 w-3.5" aria-label="Poor connection" /> : <Wifi className="h-3.5 w-3.5" aria-label="Connection good" />}
        </span>
      ) : null}
      {reactions.length ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center gap-1" aria-live="polite">
          {reactions.map((r) => (
            <span key={r.id} className="animate-slide-up text-4xl drop-shadow" role="img" aria-label={`${name} reacted ${r.emoji}`}>
              {r.emoji}
            </span>
          ))}
        </div>
      ) : null}
      <div className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded-lg bg-ink-950/70 px-2 py-1 text-xs font-medium text-white">
        {isScreen ? <MonitorUp className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {!isScreen && !micOn ? <MicOff className="h-3.5 w-3.5 text-danger-50" aria-label="Muted" /> : null}
        <span className="truncate">
          {isScreen ? `${name}'s screen` : name}
          {isLocal && !isScreen ? " (you)" : ""}
        </span>
      </div>
    </div>
  );
}

/** Plays a remote audio track; follows the selected speaker where supported. */
export function AudioTrack({ track, sinkId }: { track: TrackType; sinkId: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && sinkId) void el.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId]);
  return <audio ref={ref} autoPlay />;
}
