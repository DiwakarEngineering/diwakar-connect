import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Clock, Video } from "lucide-react-native";
import { friendlyError, supabase } from "@/lib/supabase";
import { Button, Field } from "@/components/ui";
import { colors } from "@/theme";
import { formatCode, whenText } from "@/meetings/meetings";

type Found = { meeting_id: string; title: string; starts_at: string; ends_at: string; conversation_id: string | null; is_member: boolean; cancelled: boolean };
type View_ = { kind: "form" } | { kind: "waiting"; lobbyId: string; meeting: Found } | { kind: "rejected" };

const digitsOf = (s: string) => s.replace(/\D/g, "").slice(0, 10);

/**
 * Join a meeting with its ID (and passcode, unless you're invited). Invitees go
 * straight in; other employees wait in the lobby until the organizer admits them.
 * Meeting links (…/meet/<ID>) open here with the ID filled in.
 */
export default function JoinMeeting() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(() => digitsOf(params.code ?? ""));
  const [passcode, setPasscode] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View_>({ kind: "form" });
  const looked = useRef<string | null>(null);

  const enter = useCallback((m: Found) => {
    if (!m.conversation_id) return;
    router.replace({ pathname: "/call/[conversationId]", params: { conversationId: m.conversation_id, media: "video", title: m.title } });
  }, []);

  const lookUp = useCallback(
    async (digits: string) => {
      setError(null);
      setBusy(true);
      const { data, error: e } = await supabase.rpc("meeting_by_code", { p_code: digits });
      setBusy(false);
      const m = data?.[0] as Found | undefined;
      if (e || !m) {
        setFound(null);
        setError(e ? friendlyError(e) : "No meeting has this ID. Check the number and try again.");
        return null;
      }
      if (m.cancelled) {
        setFound(null);
        setError("This meeting was cancelled.");
        return null;
      }
      setFound(m);
      // Invited (or already admitted): straight into the call.
      if (m.is_member) enter(m);
      return m;
    },
    [enter],
  );

  // Opened from a meeting link: look it up right away.
  useEffect(() => {
    const digits = digitsOf(params.code ?? "");
    if (digits.length === 10 && looked.current !== digits) {
      looked.current = digits;
      const t = setTimeout(() => void lookUp(digits), 0);
      return () => clearTimeout(t);
    }
  }, [lookUp, params.code]);

  async function submit() {
    const digits = digitsOf(code);
    if (digits.length !== 10) return setError("The meeting ID has 10 digits.");
    const m = found?.meeting_id && looked.current === digits ? found : await lookUp(digits);
    looked.current = digits;
    if (!m || m.is_member) return;
    if (!passcode.trim()) return setError("Enter the meeting passcode.");
    setBusy(true);
    const { data: lobbyId, error: e } = await supabase.rpc("request_meeting_access", { p_code: digits, p_passcode: passcode.trim() });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    if (!lobbyId) {
      // No lobby needed: we're already a member now.
      enter(m);
      return;
    }
    setView({ kind: "waiting", lobbyId, meeting: m });
  }

  // Waiting in the lobby: go in as soon as the organizer admits us.
  useEffect(() => {
    if (view.kind !== "waiting") return;
    const check = async () => {
      const { data } = await supabase.from("meeting_lobby").select("status").eq("id", view.lobbyId).maybeSingle();
      if (data?.status === "admitted") enter(view.meeting);
      else if (data?.status === "rejected") setView({ kind: "rejected" });
    };
    void check();
    const channel = supabase
      .channel(`lobby:${view.lobbyId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meeting_lobby", filter: `id=eq.${view.lobbyId}` }, () => void check())
      .subscribe();
    const poll = setInterval(() => void check(), 5000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [enter, view]);

  if (view.kind === "waiting") {
    return (
      <View style={st.center}>
        <View style={st.icon}>
          <Clock size={26} color={colors.brand600} />
        </View>
        <Text style={st.title}>{view.meeting.title}</Text>
        <Text style={st.text}>{"You're in the lobby. The organizer has been told you're waiting; you'll join automatically when they let you in."}</Text>
        <ActivityIndicator color={colors.brand600} style={{ marginTop: 8 }} />
        <Button title="Leave the lobby" variant="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }
  if (view.kind === "rejected") {
    return (
      <View style={st.center}>
        <Text style={st.title}>{"You weren't admitted"}</Text>
        <Text style={st.text}>The organizer declined your request to join.</Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.white }} contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
      <Text style={st.text}>{"Enter the meeting ID and passcode from the invitation. If you're invited, the ID is enough."}</Text>
      <Field
        label="Meeting ID"
        value={code.length > 6 ? formatCode(code) : code}
        onChangeText={(t) => {
          setCode(digitsOf(t));
          setFound(null);
          setError(null);
        }}
        keyboardType="number-pad"
        placeholder="123 456 7890"
        autoFocus={!params.code}
      />
      {found ? (
        <View style={st.found}>
          <Video size={18} color={colors.brand600} />
          <View style={{ flex: 1 }}>
            <Text style={st.foundTitle} numberOfLines={2}>{found.title}</Text>
            <Text style={st.foundWhen}>{whenText(found)}</Text>
          </View>
        </View>
      ) : null}
      <Field label="Passcode" value={passcode} onChangeText={setPasscode} autoCapitalize="characters" autoCorrect={false} placeholder="6 characters" maxLength={12} />
      {error ? <Text style={st.error}>{error}</Text> : null}
      <Button title="Join meeting" onPress={() => void submit().catch((e: Error) => Alert.alert("Couldn't join", e.message))} loading={busy} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  center: { flex: 1, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  icon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink900, textAlign: "center" },
  text: { fontSize: 15, color: colors.ink600, textAlign: "center", lineHeight: 21 },
  found: { flexDirection: "row", gap: 10, alignItems: "center", padding: 12, borderRadius: 12, backgroundColor: colors.brand50 },
  foundTitle: { fontSize: 15, fontWeight: "700", color: colors.ink900 },
  foundWhen: { fontSize: 13, color: colors.ink600 },
  error: { fontSize: 14, color: colors.danger600 },
});
