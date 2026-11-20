import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Participant } from "livekit-client";
import { Hand, Mic, MicOff, MonitorUp, UserCheck, UserMinus, UserX, Video, VideoOff, X } from "lucide-react-native";
import type { Tables } from "@/lib/database.types";
import { friendlyError, supabase } from "@/lib/supabase";
import type { Person } from "@/providers/people";
import { Avatar } from "@/components/ui";
import { colors } from "@/theme";

export type LobbyEntry = Tables<"meeting_lobby">;
export type Ring = Pick<Tables<"call_invites">, "user_id" | "status">;

export const handRaised = (p: Participant) => p.attributes?.hand === "up";
export const presenting = (p: Participant) => !!p.attributes?.share || p.isScreenShareEnabled;

/** The scheduled meeting behind this conversation (if any): who organizes it, and its live lobby for managers. */
export function useMeetingLobby(conversationId: string) {
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [organizerId, setOrganizerId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [waiting, setWaiting] = useState<LobbyEntry[]>([]);

  useEffect(() => {
    void supabase
      .from("meetings")
      .select("id, organizer_id")
      .eq("conversation_id", conversationId)
      .is("cancelled_at", null)
      .order("starts_at", { ascending: false })
      .limit(1)
      .then(async ({ data }) => {
        const m = data?.[0];
        if (!m) return;
        setMeetingId(m.id);
        setOrganizerId(m.organizer_id);
        setCanManage(!!(await supabase.rpc("can_manage_meeting", { p_meeting: m.id })).data);
      });
  }, [conversationId]);

  useEffect(() => {
    if (!meetingId || !canManage) return;
    const load = () =>
      void supabase
        .from("meeting_lobby")
        .select("*")
        .eq("meeting_id", meetingId)
        .eq("status", "waiting")
        .order("created_at")
        .then(({ data }) => setWaiting(data ?? []));
    load();
    const channel = supabase
      .channel(`call-lobby:${meetingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_lobby", filter: `meeting_id=eq.${meetingId}` }, load)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canManage, meetingId]);

  const decide = useCallback(async (entry: LobbyEntry, admit: boolean) => {
    const { error } = await supabase.rpc("decide_lobby", { p_lobby_id: entry.id, p_admit: admit });
    if (error) Alert.alert(admit ? "Couldn't admit" : "Couldn't reject", friendlyError(error));
    else setWaiting((w) => w.filter((x) => x.id !== entry.id));
  }, []);

  return { meetingId, organizerId, canManage, waiting, decide };
}

/** Who was rung for this call and how they answered (live). */
export function useRings(callId: string | null) {
  const [rings, setRings] = useState<Ring[]>([]);
  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    const load = () =>
      void supabase
        .from("call_invites")
        .select("user_id, status")
        .eq("call_id", callId)
        .then(({ data }) => {
          if (!cancelled) setRings(data ?? []);
        });
    load();
    const channel = supabase
      .channel(`call-rings:${callId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_invites", filter: `call_id=eq.${callId}` }, load)
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [callId]);
  return rings;
}

const RING_LABEL: Record<Ring["status"], string> = { ringing: "Ringing...", accepted: "Joined", declined: "Declined", missed: "No answer" };

export function ParticipantsSheet({
  visible,
  onClose,
  participants,
  me,
  organizerId,
  people,
  rings,
  waiting,
  canModerate,
  onMute,
  onMuteAll,
  onRemove,
  onDecide,
}: {
  visible: boolean;
  onClose: () => void;
  participants: Participant[];
  me: string;
  organizerId: string | null;
  people: Map<string, Person>;
  rings: Ring[];
  waiting: LobbyEntry[];
  canModerate: boolean;
  onMute: (identity: string) => void;
  onMuteAll: () => void;
  onRemove: (identity: string) => void;
  onDecide: (entry: LobbyEntry, admit: boolean) => void;
}) {
  const nameOf = (p: Participant) => (p.identity === me ? "You" : (people.get(p.identity)?.display_name ?? (p.name || "Guest")));
  const inCall = new Set(participants.map((p) => p.identity));
  const sorted = [...participants].sort((a, b) => Number(handRaised(b)) - Number(handRaised(a)) || Number(b.identity === me) - Number(a.identity === me));
  const pending = rings.filter((r) => !inCall.has(r.user_id) && r.status !== "accepted");

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={st.root} edges={["top", "bottom"]}>
        <View style={st.head}>
          <Text style={st.title}>Participants ({participants.length})</Text>
          {canModerate && participants.length > 1 ? (
            <Pressable accessibilityRole="button" onPress={onMuteAll} style={st.muteAll}>
              <MicOff size={15} color={colors.ink800} />
              <Text style={st.muteAllText}>Mute all</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Close participants" onPress={onClose} hitSlop={8} style={st.close}>
            <X size={22} color={colors.ink700} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {canModerate && waiting.length ? (
            <View style={st.section}>
              <Text style={st.sectionTitle}>Waiting in the lobby ({waiting.length})</Text>
              {waiting.map((l) => {
                const p = l.user_id ? people.get(l.user_id) : undefined;
                const name = l.guest_name ? `${l.guest_name} (guest)` : (p?.display_name ?? "Employee");
                return (
                  <View key={l.id} style={st.row}>
                    <Avatar name={l.guest_name ?? p?.display_name ?? "?"} path={p?.avatar_path} userId={l.user_id ?? l.id} size="sm" />
                    <Text style={st.name} numberOfLines={1}>{name}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Admit ${name}`} onPress={() => onDecide(l, true)} style={[st.round, { backgroundColor: colors.success600 }]}>
                      <UserCheck size={16} color={colors.white} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Reject ${name}`} onPress={() => onDecide(l, false)} style={[st.round, { backgroundColor: colors.ink100 }]}>
                      <UserX size={16} color={colors.danger600} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={st.section}>
            <Text style={st.sectionTitle}>In the meeting</Text>
            {sorted.map((p) => {
              const person = people.get(p.identity);
              const role = p.identity === organizerId ? "Organizer" : presenting(p) ? "Presenter" : p.identity.startsWith("guest:") ? "Guest" : "Attendee";
              return (
                <View key={p.identity} style={st.row}>
                  <Avatar name={person?.display_name ?? p.name ?? "Guest"} path={person?.avatar_path} userId={p.identity} size="sm" />
                  <View style={{ flex: 1 }}>
                    <Text style={st.name} numberOfLines={1}>{nameOf(p)}</Text>
                    <Text style={st.role}>{role}</Text>
                  </View>
                  {handRaised(p) ? <Hand size={17} color={colors.brand600} accessibilityLabel="Hand raised" /> : null}
                  {p.isScreenShareEnabled ? <MonitorUp size={17} color={colors.ink500} accessibilityLabel="Sharing screen" /> : null}
                  {p.isCameraEnabled ? <Video size={17} color={colors.ink500} /> : <VideoOff size={17} color={colors.ink300} />}
                  {p.isMicrophoneEnabled ? <Mic size={17} color={colors.ink500} /> : <MicOff size={17} color={colors.ink300} />}
                  {canModerate && p.identity !== me ? (
                    <>
                      {p.isMicrophoneEnabled ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Mute ${nameOf(p)}`} onPress={() => onMute(p.identity)} style={st.round}>
                          <MicOff size={15} color={colors.ink800} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${nameOf(p)}`}
                        onPress={() =>
                          Alert.alert(`Remove ${nameOf(p)}?`, "They leave the call now.", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Remove", style: "destructive", onPress: () => onRemove(p.identity) },
                          ])
                        }
                        style={st.round}
                      >
                        <UserMinus size={15} color={colors.danger600} />
                      </Pressable>
                    </>
                  ) : null}
                </View>
              );
            })}
          </View>

          {pending.length ? (
            <View style={st.section}>
              <Text style={st.sectionTitle}>Invited</Text>
              {pending.map((r) => {
                const person = people.get(r.user_id);
                return (
                  <View key={r.user_id} style={st.row}>
                    <Avatar name={person?.display_name ?? "?"} path={person?.avatar_path} userId={r.user_id} size="sm" />
                    <Text style={st.name} numberOfLines={1}>{person?.display_name ?? "Employee"}</Text>
                    <Text style={[st.role, r.status === "declined" && { color: colors.danger600 }]}>{RING_LABEL[r.status]}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.ink900 },
  muteAll: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.line },
  muteAllText: { fontSize: 13, fontWeight: "600", color: colors.ink800 },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  section: { paddingHorizontal: 16, paddingTop: 14 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.ink500, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: colors.ink900 },
  role: { fontSize: 12, color: colors.ink500 },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.ink100, alignItems: "center", justifyContent: "center" },
});
