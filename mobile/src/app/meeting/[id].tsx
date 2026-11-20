import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, MessageSquare, Share2, UserCheck, UserX, Video } from "lucide-react-native";
import type { Tables } from "@/lib/database.types";
import { friendlyError, supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { usePeopleById } from "@/providers/people";
import { Avatar, Button, EmptyState, Loading } from "@/components/ui";
import { colors } from "@/theme";
import { RESPONSE_LABEL, formatCode, invitationText, joinMeetingCall, joinable, whenText, type Meeting } from "@/meetings/meetings";

type Invitee = Tables<"meeting_invitees">;
type Lobby = Tables<"meeting_lobby">;

/** One meeting: when, join information, my response, invitees, lobby (organizer), cancel. */
export default function MeetingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [lobby, setLobby] = useState<Lobby[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { data: m, error: e } = await supabase.from("meetings").select("*").eq("id", id).maybeSingle();
    if (e || !m) {
      setError(e ? friendlyError(e) : "This meeting doesn't exist or you don't have access to it.");
      return;
    }
    const [inv, manage, calls] = await Promise.all([
      supabase.from("meeting_invitees").select("*").eq("meeting_id", id),
      supabase.rpc("can_manage_meeting", { p_meeting: id }),
      supabase.from("calls").select("id").eq("conversation_id", m.conversation_id).eq("status", "active").limit(1),
    ]);
    setMeeting(m);
    setInvitees(inv.data ?? []);
    setCanManage(!!manage.data);
    setLive(!!calls.data?.length);
    if (manage.data) {
      const { data } = await supabase.from("meeting_lobby").select("*").eq("meeting_id", id).eq("status", "waiting").order("created_at");
      setLobby(data ?? []);
    }
    setNow(Date.now());
  }, [id]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const channel = supabase
      .channel(`meeting:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings", filter: `id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_lobby", filter: `meeting_id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => void load())
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      void supabase.removeChannel(channel);
    };
  }, [id, load]);

  const people = usePeopleById([meeting?.organizer_id, ...invitees.map((i) => i.user_id), ...lobby.map((l) => l.user_id)]);

  if (error) return <EmptyState title="Meeting unavailable" description={error} />;
  if (!meeting) return <Loading />;

  const mine = invitees.find((i) => i.user_id === userId);
  const isOrganizer = meeting.organizer_id === userId;
  const canJoin = joinable({ ...meeting, live }, now);
  const organizerName = isOrganizer ? "You" : (meeting.organizer_id && people.get(meeting.organizer_id)?.display_name) || "Organizer";

  async function respond(response: "accepted" | "tentative" | "declined") {
    setBusy(response);
    const { error: e } = await supabase.rpc("respond_to_meeting", { p_meeting_id: id, p_response: response });
    setBusy(null);
    if (e) Alert.alert("Couldn't save your response", friendlyError(e));
    else void load();
  }

  async function decide(l: Lobby, admit: boolean) {
    setBusy(l.id);
    const { error: e } = await supabase.rpc("decide_lobby", { p_lobby_id: l.id, p_admit: admit });
    setBusy(null);
    if (e) Alert.alert(admit ? "Couldn't admit" : "Couldn't reject", friendlyError(e));
    else void load();
  }

  function cancel() {
    Alert.alert("Cancel this meeting?", "Everyone invited is told it's cancelled.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel meeting",
        style: "destructive",
        onPress: async () => {
          const { error: e } = await supabase.rpc("cancel_meeting", { p_meeting_id: id });
          if (e) Alert.alert("Couldn't cancel", friendlyError(e));
          else void load();
        },
      },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={st.page}>
      <Stack.Screen options={{ title: "Meeting" }} />
      <View style={st.card}>
        <View style={st.row}>
          {live ? <Text style={st.live}>LIVE</Text> : null}
          {meeting.cancelled_at ? <Text style={[st.live, { backgroundColor: colors.ink500 }]}>CANCELLED</Text> : null}
        </View>
        <Text style={[st.title, meeting.cancelled_at && { textDecorationLine: "line-through", color: colors.ink400 }]}>{meeting.title}</Text>
        <Text style={st.when}>{whenText(meeting)}</Text>
        <Text style={st.muted}>Organized by {organizerName}</Text>
        {meeting.description ? <Text style={st.agenda}>{meeting.description}</Text> : null}
        <View style={st.buttons}>
          {canJoin ? (
            <Button title="Join meeting" icon={<Video size={18} color={colors.white} />} onPress={() => joinMeetingCall(meeting.conversation_id, meeting.title)} style={{ flexGrow: 1 }} />
          ) : null}
          <Button
            title="Meeting chat"
            variant="secondary"
            icon={<MessageSquare size={18} color={colors.ink800} />}
            onPress={() => router.push({ pathname: "/chat/[id]", params: { id: meeting.conversation_id } })}
            style={{ flexGrow: 1 }}
          />
        </View>
        {!canJoin && !meeting.cancelled_at ? <Text style={st.hint}>You can join from 15 minutes before the start.</Text> : null}
      </View>

      {mine && !isOrganizer && !meeting.cancelled_at ? (
        <View style={st.card}>
          <Text style={st.section}>Your response</Text>
          <View style={st.rsvp}>
            {(["accepted", "tentative", "declined"] as const).map((r) => (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityState={{ selected: mine.response === r }}
                disabled={!!busy}
                onPress={() => void respond(r)}
                style={[st.choice, mine.response === r && st.choiceOn]}
              >
                {mine.response === r ? <Check size={15} color={colors.white} /> : null}
                <Text style={[st.choiceText, mine.response === r && { color: colors.white }]}>{r === "accepted" ? "Accept" : r === "tentative" ? "Tentative" : "Decline"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {canManage && lobby.length ? (
        <View style={[st.card, { borderColor: colors.brand300 }]}>
          <Text style={st.section}>Waiting in the lobby ({lobby.length})</Text>
          {lobby.map((l) => {
            const p = l.user_id ? people.get(l.user_id) : undefined;
            const name = l.guest_name ? `${l.guest_name} (guest)` : (p?.display_name ?? "Employee");
            return (
              <View key={l.id} style={st.person}>
                <Avatar name={l.guest_name ?? p?.display_name ?? "?"} path={p?.avatar_path} userId={l.user_id ?? l.id} size="sm" />
                <Text style={st.personName} numberOfLines={1}>{name}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Admit ${name}`} disabled={busy === l.id} onPress={() => void decide(l, true)} style={[st.small, { backgroundColor: colors.success600 }]}>
                  <UserCheck size={16} color={colors.white} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Reject ${name}`} disabled={busy === l.id} onPress={() => void decide(l, false)} style={[st.small, { backgroundColor: colors.ink100 }]}>
                  <UserX size={16} color={colors.danger600} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={st.card}>
        <Text style={st.section}>Joining information</Text>
        <Text style={st.label}>Meeting ID</Text>
        <Text style={st.code}>{formatCode(meeting.code)}</Text>
        <Text style={st.label}>Passcode</Text>
        <Text style={st.code}>{meeting.passcode}</Text>
        <View style={st.buttons}>
          <Button
            title="Share invitation"
            variant="secondary"
            icon={<Share2 size={18} color={colors.ink800} />}
            onPress={() => void Share.share({ message: invitationText(meeting) })}
            style={{ flexGrow: 1 }}
          />
          <Button
            title="Copy"
            variant="secondary"
            icon={<Copy size={18} color={colors.ink800} />}
            onPress={() => {
              void Clipboard.setStringAsync(invitationText(meeting));
              Alert.alert("Invitation copied");
            }}
          />
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.section}>Invited ({invitees.length})</Text>
        {invitees.length === 0 ? <Text style={st.muted}>No one invited yet. Share the invitation or the meeting ID and passcode.</Text> : null}
        {invitees.map((i) => {
          const p = people.get(i.user_id);
          return (
            <View key={i.user_id} style={st.person}>
              <Avatar name={p?.display_name ?? "?"} path={p?.avatar_path} userId={i.user_id} availability={p?.availability} showPresence size="sm" />
              <Text style={st.personName} numberOfLines={1}>{i.user_id === userId ? "You" : (p?.display_name ?? "Employee")}</Text>
              <Text style={[st.response, i.response === "accepted" && { color: colors.success600 }, i.response === "declined" && { color: colors.danger600 }]}>
                {RESPONSE_LABEL[i.response]}
              </Text>
            </View>
          );
        })}
      </View>

      {canManage && !meeting.cancelled_at ? (
        <Button title="Cancel meeting" variant="secondary" onPress={cancel} style={{ borderColor: colors.danger600 }} />
      ) : null}
      {canManage ? <Text style={[st.hint, { textAlign: "center" }]}>To change the time or invite more people, edit the meeting on the website.</Text> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 6 },
  row: { flexDirection: "row", gap: 6 },
  live: { fontSize: 10, fontWeight: "800", color: colors.white, backgroundColor: colors.danger600, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden", alignSelf: "flex-start" },
  title: { fontSize: 22, fontWeight: "700", color: colors.ink900 },
  when: { fontSize: 15, color: colors.ink700 },
  muted: { fontSize: 14, color: colors.ink500 },
  agenda: { fontSize: 15, color: colors.ink800, marginTop: 6, lineHeight: 21 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  hint: { fontSize: 13, color: colors.ink500, marginTop: 4 },
  section: { fontSize: 15, fontWeight: "700", color: colors.ink900, marginBottom: 4 },
  rsvp: { flexDirection: "row", gap: 8 },
  choice: { flex: 1, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", height: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  choiceOn: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  choiceText: { fontSize: 14, fontWeight: "600", color: colors.ink800 },
  label: { fontSize: 13, color: colors.ink500, marginTop: 4 },
  code: { fontSize: 18, fontWeight: "700", color: colors.ink900, letterSpacing: 2, fontVariant: ["tabular-nums"] },
  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  personName: { flex: 1, fontSize: 15, color: colors.ink900 },
  response: { fontSize: 13, fontWeight: "600", color: colors.ink500 },
  small: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
