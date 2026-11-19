import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import { requestRecordingPermissionsAsync } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { AudioSession, VideoTrack } from "@livekit/react-native";
import { ConnectionQuality, DisconnectReason, LocalVideoTrack, Room, RoomEvent, Track, type Participant } from "livekit-client";
import { Mic, MicOff, PhoneOff, RefreshCcw, SwitchCamera, Video, VideoOff, Volume2, Wifi, WifiOff } from "lucide-react-native";
import { siteApi } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { usePeopleById } from "@/providers/people";
import { usePresence } from "@/providers/presence";
import { Avatar } from "@/components/ui";
import { colors } from "@/theme";

type TokenResponse = { token: string; serverUrl: string; call: { id: string; conversationId: string; media: "audio" | "video"; startedAt: string } };
type Phase = { kind: "connecting" } | { kind: "connected" } | { kind: "reconnecting" } | { kind: "ended"; message: string } | { kind: "error"; message: string };
type TrackRef = ComponentProps<typeof VideoTrack>["trackRef"];

const DISCONNECT: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.ROOM_DELETED]: "The call has ended.",
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the call.",
  [DisconnectReason.DUPLICATE_IDENTITY]: "You joined this call from another device.",
};

function useElapsed(since: string | null) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!since) return;
    const update = () => setNow(Date.now());
    const t = setInterval(update, 1000);
    const first = setTimeout(update, 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [since]);
  if (!since || now === null) return "";
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Real LiveKit audio/video call (WebRTC through the same SFU the website uses). */
export function CallView({ conversationId, media, title }: { conversationId: string; media: "audio" | "video"; title: string }) {
  useKeepAwake();
  const { userId } = useSession();
  const { setMyActivity } = usePresence();
  const { width } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [call, setCall] = useState<TokenResponse["call"] | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(media === "video");
  const [speaker, setSpeaker] = useState(media === "video");
  const [front, setFront] = useState(true);
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const roomRef = useRef<Room | null>(null);
  const leaving = useRef(false);
  const elapsed = useElapsed(phase.kind === "connected" || phase.kind === "reconnecting" ? (call?.startedAt ?? null) : null);

  // Everyone sees "In a call" while connected.
  const inCall = phase.kind === "connected" || phase.kind === "reconnecting";
  useEffect(() => {
    setMyActivity(inCall ? "call" : null);
    return () => setMyActivity(null);
  }, [inCall, setMyActivity]);

  useEffect(() => {
    let cancelled = false;
    let callId: string | null = null;
    (async () => {
      const mic = await requestRecordingPermissionsAsync();
      if (!mic.granted) {
        setPhase({ kind: "error", message: "Diwakar Connect needs microphone access for calls. Allow it in your phone's settings and try again." });
        return;
      }
      if (media === "video") {
        const cam = await ImagePicker.requestCameraPermissionsAsync();
        if (!cam.granted) setCamOn(false);
      }
      let info: TokenResponse;
      try {
        info = await siteApi<TokenResponse>("/api/calls/token", { conversationId, media });
      } catch (e) {
        const err = e as Error & { code?: string };
        setPhase({ kind: "error", message: err.code === "not_configured" ? "Calling isn't set up for your organization yet." : err.message });
        return;
      }
      if (cancelled) return;
      callId = info.call.id;
      setCall(info.call);
      await AudioSession.startAudioSession();
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
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
        .on(RoomEvent.ConnectionQualityChanged, bump)
        .on(RoomEvent.Reconnecting, () => setPhase({ kind: "reconnecting" }))
        .on(RoomEvent.SignalReconnecting, () => setPhase({ kind: "reconnecting" }))
        .on(RoomEvent.Reconnected, () => setPhase({ kind: "connected" }))
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          roomRef.current = null;
          if (leaving.current) return;
          if (callId) void siteApi("/api/calls/leave", { callId }).catch(() => undefined);
          setPhase({ kind: "ended", message: (reason !== undefined && DISCONNECT[reason]) || "The connection to the call was lost." });
        });
      try {
        await room.connect(info.serverUrl, info.token);
      } catch {
        roomRef.current = null;
        void siteApi("/api/calls/leave", { callId: info.call.id }).catch(() => undefined);
        setPhase({ kind: "error", message: "Couldn't connect to the call service. Check your connection and try again." });
        return;
      }
      if (cancelled) {
        void room.disconnect();
        return;
      }
      setPhase({ kind: "connected" });
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        setMicOn(false);
      }
      if (media === "video") {
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          setCamOn(false);
        }
      }
      void selectOutput(media === "video");
      bump();
    })();
    return () => {
      cancelled = true;
      leaving.current = true;
      const room = roomRef.current;
      roomRef.current = null;
      if (room) void room.disconnect();
      if (callId) void siteApi("/api/calls/leave", { callId }).catch(() => undefined);
      void AudioSession.stopAudioSession();
    };
  }, [bump, conversationId, media]);

  async function selectOutput(loud: boolean) {
    try {
      if (Platform.OS === "ios") await AudioSession.selectAudioOutput(loud ? "force_speaker" : "default");
      else await AudioSession.selectAudioOutput(loud ? "speaker" : "earpiece");
      setSpeaker(loud);
    } catch {
      /* not every device exposes every route */
    }
  }

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!micOn);
      setMicOn(!micOn);
    } catch {
      Alert.alert("Microphone unavailable");
    }
  }

  async function toggleCam() {
    const room = roomRef.current;
    if (!room) return;
    if (!camOn) {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam.granted) {
        Alert.alert("Camera access needed", "Allow camera access for Diwakar Connect in your phone's settings.");
        return;
      }
    }
    try {
      await room.localParticipant.setCameraEnabled(!camOn);
      setCamOn(!camOn);
    } catch {
      Alert.alert("Camera unavailable");
    }
  }

  async function flip() {
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;
    if (track instanceof LocalVideoTrack) {
      await track.restartTrack({ facingMode: front ? "environment" : "user" });
      setFront(!front);
    }
  }

  async function leave() {
    leaving.current = true;
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    if (call) await siteApi("/api/calls/leave", { callId: call.id }).catch(() => undefined);
    router.back();
  }

  const room = roomRef.current;
  const participants: Participant[] = room ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())] : [];
  const people = usePeopleById(participants.map((p) => p.identity));
  const speakers = new Set((room?.activeSpeakers ?? []).map((p) => p.identity));

  const cols = participants.length <= 1 ? 1 : participants.length <= 4 ? 2 : 3;
  const tileW = (width - 12 * (cols + 1)) / cols;
  const tileH = participants.length <= 2 ? tileW * (cols === 1 ? 1.25 : 1.4) : tileW * 1.25;

  const statusText = useMemo(() => {
    if (phase.kind === "connecting") return "Connecting...";
    if (phase.kind === "reconnecting") return "Reconnecting...";
    if (phase.kind === "connected") return participants.length <= 1 ? `Waiting for others · ${elapsed}` : elapsed;
    return "";
  }, [elapsed, participants.length, phase.kind]);

  if (phase.kind === "ended" || phase.kind === "error") {
    return (
      <SafeAreaView style={[st.root, { alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }]}>
        <Text style={st.endTitle}>{phase.kind === "ended" ? "Call ended" : "Couldn't join the call"}</Text>
        <Text style={st.endText}>{phase.message}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={st.endButton}>
          <Text style={st.endButtonText}>Back to chat</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root}>
      <View style={st.top}>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
        <Text style={[st.status, phase.kind === "reconnecting" && { color: colors.brand300 }]} accessibilityLiveRegion="polite">
          {statusText}
        </Text>
      </View>
      <FlatList
        data={participants}
        key={cols}
        numColumns={cols}
        keyExtractor={(p) => p.identity}
        contentContainerStyle={{ padding: 6, flexGrow: 1, justifyContent: "center" }}
        renderItem={({ item }) => {
          const pub = item.getTrackPublication(Track.Source.Camera);
          const hasVideo = !!pub?.track && !pub.isMuted;
          const ref: TrackRef = hasVideo ? ({ participant: item, publication: pub, source: Track.Source.Camera } as unknown as TrackRef) : undefined;
          const person = people.get(item.identity);
          const name = item.identity === userId ? "You" : (person?.display_name ?? item.name ?? "Participant");
          const micMuted = !item.isMicrophoneEnabled;
          const poor = item.connectionQuality === ConnectionQuality.Poor || item.connectionQuality === ConnectionQuality.Lost;
          return (
            <View style={[st.tile, { width: tileW, height: tileH }, speakers.has(item.identity) && st.speaking]}>
              {hasVideo ? (
                <VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit="cover" mirror={item.isLocal && front} />
              ) : (
                <View style={st.noVideo}>
                  <Avatar name={person?.display_name ?? name} path={person?.avatar_path} userId={item.identity} size={cols >= 3 ? "lg" : "xl"} />
                </View>
              )}
              <View style={st.label}>
                {micMuted ? <MicOff size={13} color={colors.white} /> : <Mic size={13} color={colors.white} />}
                <Text style={st.labelText} numberOfLines={1}>{name}</Text>
                {poor ? <WifiOff size={13} color={colors.brand300} /> : item.connectionQuality === ConnectionQuality.Excellent ? <Wifi size={13} color={colors.white} /> : null}
              </View>
            </View>
          );
        }}
      />
      <View style={st.controls}>
        <Control label={micOn ? "Mute microphone" : "Unmute microphone"} onPress={() => void toggleMic()} active={!micOn}>
          {micOn ? <Mic size={24} color={colors.white} /> : <MicOff size={24} color={colors.white} />}
        </Control>
        <Control label={camOn ? "Turn camera off" : "Turn camera on"} onPress={() => void toggleCam()} active={camOn}>
          {camOn ? <Video size={24} color={colors.white} /> : <VideoOff size={24} color={colors.white} />}
        </Control>
        {camOn ? (
          <Control label="Switch camera" onPress={() => void flip()}>
            <SwitchCamera size={24} color={colors.white} />
          </Control>
        ) : null}
        <Control label={speaker ? "Use earpiece" : "Use speaker"} onPress={() => void selectOutput(!speaker)} active={speaker}>
          <Volume2 size={24} color={colors.white} />
        </Control>
        <Pressable accessibilityRole="button" accessibilityLabel="Leave call" onPress={() => void leave()} style={[st.control, { backgroundColor: colors.danger600 }]}>
          <PhoneOff size={26} color={colors.white} />
        </Pressable>
      </View>
      {phase.kind === "reconnecting" ? (
        <View style={st.banner}>
          <RefreshCcw size={14} color={colors.white} />
          <Text style={st.bannerText}>Network interrupted. Reconnecting automatically...</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Control({ label, onPress, active, children }: { label: string; onPress: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [st.control, active && { backgroundColor: colors.brand600 }, pressed && { opacity: 0.7 }]}
    >
      {children}
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.charcoal },
  top: { alignItems: "center", paddingTop: 8, paddingHorizontal: 16, gap: 2 },
  title: { color: colors.white, fontSize: 18, fontWeight: "700" },
  status: { color: colors.ink300, fontSize: 13, fontVariant: ["tabular-nums"] },
  tile: { margin: 6, borderRadius: 18, overflow: "hidden", backgroundColor: colors.charcoal2, borderWidth: 2, borderColor: "transparent" },
  speaking: { borderColor: colors.brand500 },
  noVideo: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { position: "absolute", left: 8, bottom: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  labelText: { color: colors.white, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  controls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 14, paddingVertical: 18, paddingHorizontal: 12 },
  control: { width: 58, height: 58, borderRadius: 29, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  banner: { position: "absolute", top: 70, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brand600, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  bannerText: { color: colors.white, fontSize: 13, fontWeight: "600" },
  endTitle: { color: colors.white, fontSize: 22, fontWeight: "700" },
  endText: { color: colors.ink300, fontSize: 15, textAlign: "center" },
  endButton: { backgroundColor: colors.brand600, borderRadius: 12, paddingHorizontal: 20, height: 46, justifyContent: "center" },
  endButtonText: { color: colors.white, fontWeight: "700", fontSize: 15 },
});
