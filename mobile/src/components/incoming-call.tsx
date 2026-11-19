import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Phone, PhoneOff, Video } from "lucide-react-native";
import { useActivity } from "@/providers/activity";
import { usePeopleById } from "@/providers/people";
import { colors } from "@/theme";
import { Avatar } from "./ui";

/** Full-screen ringing view shown over any screen when a colleague calls. */
export function IncomingCallOverlay() {
  const { incoming, answer, decline } = useActivity();
  const people = usePeopleById([incoming?.actorId]);
  if (!incoming) return null;
  const caller = incoming.actorId ? people.get(incoming.actorId) : undefined;
  const name = caller?.display_name ?? "A colleague";
  const video = incoming.media === "video";
  return (
    <Modal visible animationType="slide" onRequestClose={decline} statusBarTranslucent>
      <SafeAreaView style={st.root}>
        <View style={st.top}>
          <Text style={st.kind}>{video ? "Incoming video call" : "Incoming audio call"}</Text>
          <View style={st.ring}>
            <Avatar name={name} path={caller?.avatar_path} userId={incoming.actorId ?? undefined} size="xl" />
          </View>
          <Text style={st.name} accessibilityRole="header">
            {name}
          </Text>
          <Text style={st.sub} numberOfLines={2}>
            {incoming.title}
          </Text>
        </View>
        <View style={st.actions}>
          <View style={st.action}>
            <Pressable accessibilityRole="button" accessibilityLabel="Decline call" onPress={decline} style={[st.round, { backgroundColor: colors.danger600 }]}>
              <PhoneOff color={colors.white} size={30} />
            </Pressable>
            <Text style={st.actionText}>Decline</Text>
          </View>
          <View style={st.action}>
            <Pressable accessibilityRole="button" accessibilityLabel="Accept call" onPress={answer} style={[st.round, { backgroundColor: colors.success600 }]}>
              {video ? <Video color={colors.white} size={30} /> : <Phone color={colors.white} size={30} />}
            </Pressable>
            <Text style={st.actionText}>Accept</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.charcoal, justifyContent: "space-between", paddingVertical: 48 },
  top: { alignItems: "center", gap: 14, paddingHorizontal: 24 },
  kind: { color: colors.brand300, fontSize: 15, fontWeight: "600", letterSpacing: 0.3 },
  ring: { padding: 8, borderRadius: 999, borderWidth: 3, borderColor: colors.brand500, marginTop: 24 },
  name: { color: colors.white, fontSize: 28, fontWeight: "700", textAlign: "center" },
  sub: { color: colors.ink300, fontSize: 15, textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 32 },
  action: { alignItems: "center", gap: 10 },
  round: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  actionText: { color: colors.white, fontSize: 15, fontWeight: "600" },
});
