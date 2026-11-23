import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Phone, Video } from "lucide-react-native";
import { initials } from "@/lib/format";
import { useSignedUrl } from "@/lib/storage";
import { useActivity } from "@/providers/activity";
import { usePeopleById } from "@/providers/people";
import { colors } from "@/theme";
import { Avatar } from "./ui";

const LOGO = require("../../assets/images/icon.png");

/**
 * Ringing screen over any screen when a colleague calls: the caller's photo blurred
 * behind (or big initials), "<name> is calling you", and round buttons to answer
 * with video, answer with audio only, or decline.
 */
export function IncomingCallOverlay() {
  const { incoming, answer, decline } = useActivity();
  const people = usePeopleById([incoming?.actorId]);
  const caller = incoming?.actorId ? people.get(incoming.actorId) : undefined;
  const photo = useSignedUrl("avatars", caller?.avatar_path, 3600);
  if (!incoming) return null;
  const name = caller?.display_name ?? "A colleague";
  const video = incoming.media === "video";
  return (
    <Modal visible animationType="fade" onRequestClose={decline} statusBarTranslucent>
      <View style={st.root}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {photo ? (
            <Image source={{ uri: photo }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} contentFit="cover" blurRadius={40} />
          ) : (
            <View style={st.bigInitialsWrap}>
              <Text style={st.bigInitials}>{initials(name)}</Text>
            </View>
          )}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(14,20,34,0.55)" }]} />
        </View>
        <SafeAreaView style={st.safe}>
          <View style={st.top}>
            <View style={st.titleRow}>
              <Image source={LOGO} style={st.logo} contentFit="contain" />
              <Text style={st.title} numberOfLines={2} accessibilityRole="header">
                <Text style={{ fontWeight: "800" }}>{name}</Text> is calling you
              </Text>
            </View>
            <Text style={st.sub} numberOfLines={2}>
              {video ? "Video call" : "Audio call"}
              {caller?.title ? ` · ${caller.title}` : ""}
            </Text>
            <View style={st.ring}>
              <Avatar name={name} path={caller?.avatar_path} userId={incoming.actorId ?? undefined} size="xl" />
            </View>
          </View>
          <View style={st.actions}>
            {video ? (
              <Round label="Video" a11y="Accept with video" color={colors.brand600} onPress={() => answer("video")}>
                <Video color={colors.white} size={28} />
              </Round>
            ) : null}
            <Round label={video ? "Audio" : "Accept"} a11y={video ? "Accept with audio only" : "Accept call"} color={colors.brand600} onPress={() => answer("audio")}>
              <Phone color={colors.white} size={28} />
            </Round>
            <Round label="Decline" a11y="Decline call" color={colors.danger600} onPress={decline}>
              <Phone color={colors.white} size={28} style={{ transform: [{ rotate: "135deg" }] }} />
            </Round>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Round({ label, a11y, color, onPress, children }: { label: string; a11y: string; color: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <View style={st.action}>
      <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={({ pressed }) => [st.round, { backgroundColor: color }, pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] }]}>
        {children}
      </Pressable>
      <Text style={st.actionText}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink900 },
  safe: { flex: 1, justifyContent: "space-between", paddingVertical: 40 },
  bigInitialsWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  bigInitials: { fontSize: 260, fontWeight: "800", color: "rgba(255,255,255,0.12)", textShadowColor: "rgba(255,255,255,0.25)", textShadowRadius: 40 },
  top: { alignItems: "center", gap: 10, paddingHorizontal: 24, marginTop: 24 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 },
  logo: { width: 28, height: 28, borderRadius: 7 },
  title: { color: colors.white, fontSize: 20, fontWeight: "500", flexShrink: 1 },
  sub: { color: "rgba(255,255,255,0.75)", fontSize: 14, textAlign: "center" },
  ring: { marginTop: 36, padding: 6, borderRadius: 999, borderWidth: 4, borderColor: "rgba(255,255,255,0.85)" },
  actions: { flexDirection: "row", justifyContent: "center", gap: 36, paddingHorizontal: 24, marginBottom: 12 },
  action: { alignItems: "center", gap: 10 },
  round: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  actionText: { color: colors.white, fontSize: 14, fontWeight: "600" },
});
