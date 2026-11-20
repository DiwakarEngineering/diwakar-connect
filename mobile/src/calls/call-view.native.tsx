import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import { requestRecordingPermissionsAsync } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { AudioSession, VideoTrack } from "@livekit/react-native";
import { ConnectionQuality, DisconnectReason, LocalVideoTrack, Room, RoomEvent, Track, type Participant, type TrackPublication } from "livekit-client";
import {
  Ear,
  FileText,
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  PhoneOff,
  RefreshCcw,
  SmilePlus,
  SwitchCamera,
  Users,
  Video,
  VideoOff,
  Volume2,
  Wifi,
  WifiOff,
} from "lucide-react-native";
import { siteApi } from "@/lib/supabase";
import { signedUrl } from "@/lib/storage";
import { useSession } from "@/providers/session";
import { usePeopleById } from "@/providers/people";
import { usePresence } from "@/providers/presence";
import { Avatar } from "@/components/ui";
import { ActionSheet } from "@/components/action-sheet";
import { colors } from "@/theme";
import { ParticipantsSheet, handRaised, useMeetingLobby, useRings, type LobbyEntry } from "./participants-sheet";
import { Whiteboard } from "./whiteboard";

type TokenResponse = { token: string; serverUrl: string; call: { id: string; conversationId: string; media: "audio" | "video"; startedAt: string; startedBy?: string | null } };
type Phase = { kind: "connecting" } | { kind: "connected" } | { kind: "reconnecting" } | { kind: "ended"; message: string } | { kind: "error"; message: string };
type TrackRef = ComponentProps<typeof VideoTrack>["trackRef"];
/** What someone presents besides a screen share (participant attribute, same as the website). */
type Share = { kind: "pdf"; path: string; name: string; page: number; pages: number } | { kind: "board"; name: string };
type Floating = { id: number; emoji: string; who: string };

const REACTIONS = ["👍", "❤️", "😂", "👏", "🎉", "😮"];

const DISCONNECT: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.ROOM_DELETED]: "The call has ended.",
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the call.",
  [DisconnectReason.DUPLICATE_IDENTITY]: "You joined this call from another device.",
};

function readShare(p: Participant): Share | null {
  const raw = p.attributes?.share;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Share;
    if (v.kind === "pdf" && typeof v.path === "string" && typeof v.page === "number") return v;
    if (v.kind === "board") return v;
  } catch {
    /* ignore malformed attribute */
  }
  return null;
}

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

/**
 * Real LiveKit audio/video call and meeting (WebRTC through the same SFU the website uses):
 * raise hand, reactions, participants (with organizer moderation and the lobby), meeting
 * chat, and what others present from a computer: screen share, whiteboard and slides.
 */
export function CallView({ conversationId, media, title }: { conversationId: string; media: "audio" | "video"; title: string }) {
  useKeepAwake();
  const { userId, role } = useSession();
  const { setMyActivity } = usePresence();
  const { width, height } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [call, setCall] = useState<TokenResponse["call"] | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(media === "video");
  const [speaker, setSpeaker] = useState(media === "video");
  const [front, setFront] = useState(true);
  const [version, setVersion] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [floating, setFloating] = useState<Floating[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const roomRef = useRef<Room | null>(null);
  const leaving = useRef(false);
  const floatId = useRef(0);
  const nameRef = useRef<(identity: string) => string>(() => "Someone");
  const elapsed = useElapsed(phase.kind === "connected" || phase.kind === "reconnecting" ? (call?.startedAt ?? null) : null);
  const lobby = useMeetingLobby(conversationId);
  const rings = useRings(call?.id ?? null);

  // Everyone sees "In a call" while connected.
  const inCall = phase.kind === "connected" || phase.kind === "reconnecting";
  useEffect(() => {
    setMyActivity(inCall ? "call" : null);
    return () => setMyActivity(null);
  }, [inCall, setMyActivity]);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000);
  }, []);

  const addReaction = useCallback((identity: string, emoji: string) => {
    const id = ++floatId.current;
    setFloating((f) => [...f.slice(-5), { id, emoji, who: nameRef.current(identity) }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 4000);
  }, []);

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
        .on(RoomEvent.TrackMuted, (pub: TrackPublication, p: Participant) => {
          // The organizer muted me from their side.
          if (p.isLocal && pub.source === Track.Source.Microphone) {
            setMicOn(false);
            showNotice("You were muted by the organizer. Unmute when you want to speak.");
          }
          bump();
        })
        .on(RoomEvent.TrackUnmuted, bump)
        .on(RoomEvent.LocalTrackPublished, bump)
        .on(RoomEvent.LocalTrackUnpublished, bump)
        .on(RoomEvent.ActiveSpeakersChanged, bump)
        .on(RoomEvent.ConnectionQualityChanged, bump)
        .on(RoomEvent.ParticipantAttributesChanged, bump)
        .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
          if (topic !== "reactions" || !participant) return;
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as { emoji?: string };
            if (msg.emoji && REACTIONS.includes(msg.emoji)) addReaction(participant.identity, msg.emoji);
          } catch {
            /* ignore malformed data messages */
          }
        })
        .on(RoomEvent.Reconnecting, () => setPhase({ kind: "reconnecting" }))
        .on(RoomEvent.SignalReconnecting, () => setPhase({ kind: "reconnecting" }))
        .on(RoomEvent.Reconnected, () => {
          setPhase({ kind: "connected" });
          bump();
        })
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
  }, [addReaction, bump, conversationId, media, showNotice]);

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
    const next = !room.localParticipant.isMicrophoneEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
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

  async function toggleHand() {
    const room = roomRef.current;
    if (!room) return;
    const up = handRaised(room.localParticipant);
    try {
      await room.localParticipant.setAttributes({ hand: up ? "" : "up" });
      bump();
    } catch {
      Alert.alert(up ? "Couldn't lower your hand" : "Couldn't raise your hand");
    }
  }

  function react(emoji: string) {
    setReactOpen(false);
    const room = roomRef.current;
    if (!room) return;
    addReaction(room.localParticipant.identity, emoji);
    void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ emoji })), { reliable: true, topic: "reactions" }).catch(() => undefined);
  }

  async function moderate(action: "mute" | "mute_all" | "remove", identity?: string) {
    if (!call) return;
    try {
      await siteApi("/api/calls/moderate", action === "mute_all" ? { callId: call.id, action } : { callId: call.id, action, userId: identity });
      showNotice(action === "mute_all" ? "Everyone else is muted." : action === "mute" ? "Muted." : "Removed from the call.");
      bump();
    } catch (e) {
      Alert.alert("Couldn't do that", (e as Error).message);
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
  const participants: Participant[] = useMemo(() => {
    void version;
    return room ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())] : [];
  }, [room, version]);

  // Safety net: after a full reconnect livekit-client can add a participant without an event.
  const roster = participants.map((p) => p.identity).join(",");
  useEffect(() => {
    if (!inCall) return;
    const t = setInterval(() => {
      const r = roomRef.current;
      if (r && [r.localParticipant.identity, ...r.remoteParticipants.keys()].join(",") !== roster) bump();
    }, 4000);
    return () => clearInterval(t);
  }, [bump, inCall, roster]);

  const people = usePeopleById([...participants.map((p) => p.identity), ...rings.map((r) => r.user_id), ...lobby.waiting.map((l) => l.user_id)]);
  const nameOf = useCallback(
    (identity: string) => {
      if (identity === userId) return "You";
      const p = room?.remoteParticipants.get(identity);
      return people.get(identity)?.display_name ?? (p?.name || "Guest");
    },
    [people, room, userId],
  );
  useEffect(() => {
    nameRef.current = nameOf;
  }, [nameOf]);

  const speakers = new Set((room?.activeSpeakers ?? []).map((p) => p.identity));
  const organizerId = lobby.organizerId ?? call?.startedBy ?? null;
  const canModerate = !!call && (call.startedBy === userId || role === "owner" || role === "admin" || lobby.canManage);
  const myHand = !!room && handRaised(room.localParticipant);
  const hands = participants.filter(handRaised).length;

  // What's on the stage (same priority as the website): a screen share, then slides, then a whiteboard.
  const screen = participants.find((p) => !p.isLocal && p.getTrackPublication(Track.Source.ScreenShare)?.track);
  const pdfBy = participants.find((p) => readShare(p)?.kind === "pdf");
  const boardBy = participants.find((p) => readShare(p)?.kind === "board");
  const stage: "screen" | "pdf" | "board" | null = screen ? "screen" : pdfBy ? "pdf" : boardBy ? "board" : null;
  const pdf = pdfBy ? (readShare(pdfBy) as Extract<Share, { kind: "pdf" }>) : null;

  const statusText = useMemo(() => {
    if (phase.kind === "connecting") return "Connecting...";
    if (phase.kind === "reconnecting") return "Reconnecting...";
    if (phase.kind === "connected") return participants.length <= 1 ? `Waiting for others · ${elapsed}` : `${elapsed} · ${participants.length} people`;
    return "";
  }, [elapsed, participants.length, phase.kind]);

  if (phase.kind === "ended" || phase.kind === "error") {
    return (
      <SafeAreaView style={[st.root, { alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }]}>
        <Text style={st.endTitle}>{phase.kind === "ended" ? "Call ended" : "Couldn't join the call"}</Text>
        <Text style={st.endText}>{phase.message}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={st.endButton}>
          <Text style={st.endButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const renderTile = (item: Participant, w: number, h: number, small: boolean) => {
    const pub = item.getTrackPublication(Track.Source.Camera);
    const hasVideo = !!pub?.track && !pub.isMuted;
    const ref: TrackRef = hasVideo ? ({ participant: item, publication: pub, source: Track.Source.Camera } as unknown as TrackRef) : undefined;
    const person = people.get(item.identity);
    const name = nameOf(item.identity);
    const poor = item.connectionQuality === ConnectionQuality.Poor || item.connectionQuality === ConnectionQuality.Lost;
    return (
      <View key={item.identity} style={[st.tile, { width: w, height: h }, speakers.has(item.identity) && st.speaking]}>
        {hasVideo ? (
          <VideoTrack trackRef={ref} style={StyleSheet.absoluteFill} objectFit="cover" mirror={item.isLocal && front} />
        ) : (
          <View style={st.noVideo}>
            <Avatar name={person?.display_name ?? name} path={person?.avatar_path} userId={item.identity} size={small ? "md" : participants.length > 4 ? "lg" : "xl"} />
          </View>
        )}
        {handRaised(item) ? (
          <View style={st.handBadge} accessibilityLabel={`${name} raised a hand`}>
            <Hand size={small ? 12 : 15} color={colors.white} />
          </View>
        ) : null}
        <View style={[st.label, small && { left: 4, right: 4, bottom: 4, paddingHorizontal: 5 }]}>
          {item.isMicrophoneEnabled ? <Mic size={12} color={colors.white} /> : <MicOff size={12} color={colors.white} />}
          <Text style={[st.labelText, small && { fontSize: 11 }]} numberOfLines={1}>{name}</Text>
          {!small && poor ? <WifiOff size={12} color={colors.brand300} /> : !small && item.connectionQuality === ConnectionQuality.Excellent ? <Wifi size={12} color={colors.white} /> : null}
        </View>
      </View>
    );
  };

  const cols = participants.length <= 1 ? 1 : participants.length <= 4 ? 2 : 3;
  const tileW = (width - 12 * (cols + 1)) / cols;
  const tileH = participants.length <= 2 ? tileW * (cols === 1 ? 1.25 : 1.4) : tileW * 1.25;

  const screenPub = screen?.getTrackPublication(Track.Source.ScreenShare);
  const screenRef = screen && screenPub ? ({ participant: screen, publication: screenPub, source: Track.Source.ScreenShare } as unknown as TrackRef) : undefined;
  const stageH = Math.min(height * 0.5, ((width - 16) * 9) / 16 + 70);

  return (
    <SafeAreaView style={st.root}>
      <View style={st.top}>
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>{title}</Text>
          <Text style={[st.status, phase.kind === "reconnecting" && { color: colors.brand300 }]} accessibilityLiveRegion="polite">
            {statusText}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Participants, ${participants.length}`} onPress={() => setPeopleOpen(true)} style={st.topButton}>
          <Users size={20} color={colors.white} />
          <Text style={st.topCount}>{participants.length}</Text>
          {hands || (canModerate && lobby.waiting.length) ? <View style={st.dot} /> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Meeting chat" onPress={() => router.push({ pathname: "/chat/[id]", params: { id: conversationId } })} style={st.topButton}>
          <MessageSquare size={20} color={colors.white} />
        </Pressable>
      </View>

      {canModerate && lobby.waiting.length ? (
        <Pressable accessibilityRole="button" onPress={() => setPeopleOpen(true)} style={st.lobby}>
          <Text style={st.lobbyText} numberOfLines={1}>
            {lobby.waiting.length === 1
              ? `${lobby.waiting[0]!.guest_name ? `${lobby.waiting[0]!.guest_name} (guest)` : (people.get(lobby.waiting[0]!.user_id ?? "")?.display_name ?? "Someone")} is waiting in the lobby`
              : `${lobby.waiting.length} people are waiting in the lobby`}
          </Text>
          <Text style={st.lobbyAction}>View</Text>
        </Pressable>
      ) : null}

      {stage ? (
        <View style={{ flex: 1 }}>
          <View style={[st.stage, stage === "screen" && { height: stageH }]}>
            {stage === "screen" && screenRef ? (
              <>
                <VideoTrack trackRef={screenRef} style={StyleSheet.absoluteFill} objectFit="contain" />
                <Text style={st.stageCaption} numberOfLines={1}>{nameOf(screen!.identity)} is sharing their screen</Text>
              </>
            ) : stage === "pdf" && pdf && pdfBy ? (
              <View style={st.pdf}>
                <View style={st.pdfIcon}>
                  <FileText size={26} color={colors.brand600} />
                </View>
                <Text style={st.pdfTitle} numberOfLines={2}>{pdf.name}</Text>
                <Text style={st.pdfSub}>
                  {nameOf(pdfBy.identity)} {pdfBy.isLocal ? "are" : "is"} presenting · slide {pdf.page} of {pdf.pages}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={async () => {
                    const url = await signedUrl("attachments", pdf.path, 600);
                    if (url) void WebBrowser.openBrowserAsync(`${url}#page=${pdf.page}`);
                    else Alert.alert("Couldn't open the file");
                  }}
                  style={st.pdfButton}
                >
                  <Text style={st.pdfButtonText}>Open the slides</Text>
                </Pressable>
                <Text style={st.pdfHint}>The slide number follows the presenter live.</Text>
              </View>
            ) : stage === "board" && boardBy && room ? (
              <ScrollView contentContainerStyle={{ padding: 8 }}>
                <Whiteboard room={room} me={room.localParticipant.identity} owner={boardBy.identity} ownerName={nameOf(boardBy.identity)} organizer={organizerId} />
              </ScrollView>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.strip}>
            {participants.map((p) => renderTile(p, 104, 132, true))}
          </ScrollView>
        </View>
      ) : (
        <FlatList
          data={participants}
          key={cols}
          numColumns={cols}
          keyExtractor={(p) => p.identity}
          contentContainerStyle={{ padding: 6, flexGrow: 1, justifyContent: "center" }}
          renderItem={({ item }) => renderTile(item, tileW, tileH, false)}
        />
      )}

      {floating.length ? (
        <View style={st.floating} pointerEvents="none">
          {floating.map((f) => (
            <View key={f.id} style={st.bubble}>
              <Text style={st.bubbleEmoji}>{f.emoji}</Text>
              <Text style={st.bubbleName} numberOfLines={1}>{f.who}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {reactOpen ? (
        <View style={st.reactions}>
          {REACTIONS.map((e) => (
            <Pressable key={e} accessibilityRole="button" accessibilityLabel={`React ${e}`} onPress={() => react(e)} style={st.reaction}>
              <Text style={{ fontSize: 26 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={st.controls}>
        <Control label={micOn ? "Mute microphone" : "Unmute microphone"} onPress={() => void toggleMic()} active={!micOn}>
          {micOn ? <Mic size={22} color={colors.white} /> : <MicOff size={22} color={colors.white} />}
        </Control>
        <Control label={camOn ? "Turn camera off" : "Turn camera on"} onPress={() => void toggleCam()} active={camOn}>
          {camOn ? <Video size={22} color={colors.white} /> : <VideoOff size={22} color={colors.white} />}
        </Control>
        <Control label={myHand ? "Lower hand" : "Raise hand"} onPress={() => void toggleHand()} active={myHand}>
          <Hand size={22} color={colors.white} />
        </Control>
        <Control label="React" onPress={() => setReactOpen((o) => !o)} active={reactOpen}>
          <SmilePlus size={22} color={colors.white} />
        </Control>
        <Control label="More options" onPress={() => setMoreOpen(true)}>
          <MoreHorizontal size={22} color={colors.white} />
        </Control>
        <Pressable accessibilityRole="button" accessibilityLabel="Leave call" onPress={() => void leave()} style={[st.control, { backgroundColor: colors.danger600 }]}>
          <PhoneOff size={24} color={colors.white} />
        </Pressable>
      </View>

      {phase.kind === "reconnecting" ? (
        <View style={st.banner}>
          <RefreshCcw size={14} color={colors.white} />
          <Text style={st.bannerText}>Network interrupted. Reconnecting automatically...</Text>
        </View>
      ) : notice ? (
        <View style={st.banner} accessibilityLiveRegion="polite">
          <Text style={st.bannerText}>{notice}</Text>
        </View>
      ) : null}

      <ActionSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        actions={[
          ...(camOn ? [{ label: "Switch camera", icon: <SwitchCamera size={20} color={colors.ink700} />, onPress: () => void flip() }] : []),
          speaker
            ? { label: "Use earpiece", icon: <Ear size={20} color={colors.ink700} />, onPress: () => void selectOutput(false) }
            : { label: "Use speaker", icon: <Volume2 size={20} color={colors.ink700} />, onPress: () => void selectOutput(true) },
          { label: `Participants (${participants.length})`, icon: <Users size={20} color={colors.ink700} />, onPress: () => setTimeout(() => setPeopleOpen(true), 350) },
          { label: "Meeting chat", icon: <MessageSquare size={20} color={colors.ink700} />, onPress: () => router.push({ pathname: "/chat/[id]", params: { id: conversationId } }) },
        ]}
      />

      <ParticipantsSheet
        visible={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        participants={participants}
        me={userId}
        organizerId={organizerId}
        people={people}
        rings={rings}
        waiting={lobby.waiting}
        canModerate={canModerate}
        onMute={(id) => void moderate("mute", id)}
        onMuteAll={() => void moderate("mute_all")}
        onRemove={(id) => void moderate("remove", id)}
        onDecide={(entry: LobbyEntry, admit: boolean) => void lobby.decide(entry, admit)}
      />
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
  top: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 6, paddingBottom: 4, paddingHorizontal: 14 },
  title: { color: colors.white, fontSize: 17, fontWeight: "700" },
  status: { color: colors.ink300, fontSize: 13, fontVariant: ["tabular-nums"] },
  topButton: { flexDirection: "row", alignItems: "center", gap: 4, height: 40, minWidth: 40, paddingHorizontal: 10, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)", justifyContent: "center" },
  topCount: { color: colors.white, fontSize: 13, fontWeight: "700" },
  dot: { position: "absolute", top: 6, right: 6, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand500 },
  lobby: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, marginTop: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.brand600 },
  lobbyText: { flex: 1, color: colors.white, fontSize: 14, fontWeight: "600" },
  lobbyAction: { color: colors.white, fontSize: 14, fontWeight: "800" },
  stage: { flex: 1, margin: 8, borderRadius: 14, overflow: "hidden", backgroundColor: colors.charcoal2 },
  stageCaption: { position: "absolute", left: 8, bottom: 8, color: colors.white, fontSize: 12, fontWeight: "600", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  pdf: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  pdfIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  pdfTitle: { color: colors.white, fontSize: 17, fontWeight: "700", textAlign: "center" },
  pdfSub: { color: colors.ink300, fontSize: 14, textAlign: "center" },
  pdfButton: { marginTop: 8, backgroundColor: colors.brand600, borderRadius: 12, paddingHorizontal: 18, height: 42, justifyContent: "center" },
  pdfButtonText: { color: colors.white, fontWeight: "700" },
  pdfHint: { color: colors.ink400, fontSize: 12, textAlign: "center" },
  strip: { paddingHorizontal: 8, paddingBottom: 4, gap: 0 },
  tile: { margin: 6, borderRadius: 16, overflow: "hidden", backgroundColor: colors.charcoal2, borderWidth: 2, borderColor: "transparent" },
  speaking: { borderColor: colors.brand500 },
  noVideo: { flex: 1, alignItems: "center", justifyContent: "center" },
  handBadge: { position: "absolute", top: 6, left: 6, backgroundColor: colors.brand600, borderRadius: 12, padding: 5 },
  label: { position: "absolute", left: 8, bottom: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  labelText: { color: colors.white, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  floating: { position: "absolute", left: 14, bottom: 110, gap: 6 },
  bubble: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 18, paddingHorizontal: 10, paddingVertical: 4, maxWidth: 220 },
  bubbleEmoji: { fontSize: 22 },
  bubbleName: { color: colors.white, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  reactions: { flexDirection: "row", alignSelf: "center", gap: 4, backgroundColor: colors.charcoal2, borderRadius: 28, padding: 6, marginBottom: 4 },
  reaction: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  controls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 10 },
  control: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  banner: { position: "absolute", top: 64, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.brand600, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, maxWidth: "92%" },
  bannerText: { color: colors.white, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  endTitle: { color: colors.white, fontSize: 22, fontWeight: "700" },
  endText: { color: colors.ink300, fontSize: 15, textAlign: "center" },
  endButton: { backgroundColor: colors.brand600, borderRadius: 12, paddingHorizontal: 20, height: 46, justifyContent: "center" },
  endButtonText: { color: colors.white, fontWeight: "700", fontSize: 15 },
});
