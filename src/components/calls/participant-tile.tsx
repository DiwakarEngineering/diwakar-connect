"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Track, type Participant, type Track as TrackType } from "livekit-client";
import { MicOff, MonitorUp } from "lucide-react";
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

export function ParticipantTile({ participant, source, name, avatarPath, isLocal, version, large }: Props) {
  void version;
  const pub = participant.getTrackPublication(source);
  const track = pub?.track;
  const showVideo = !!track && !pub?.isMuted;
  const micOn = participant.isMicrophoneEnabled;
  const isScreen = source === Track.Source.ScreenShare;

  return (
    <div
      className={clsx(
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-ink-800 ring-2 transition-shadow",
        participant.isSpeaking && !isScreen ? "ring-brand-400" : "ring-transparent",
        large && "h-full w-full",
      )}
    >
      {showVideo && track ? (
        <VideoElement track={track} mirror={isLocal && !isScreen} contain={isScreen} />
      ) : (
        <Avatar name={name} path={avatarPath} userId={participant.identity} size="xl" />
      )}
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
