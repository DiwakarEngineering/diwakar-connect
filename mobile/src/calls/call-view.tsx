import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { colors } from "@/theme";

/** Browser preview of the app: calls need the installed Android/iPhone app (native WebRTC). */
export function CallView({ title }: { conversationId: string; media: "audio" | "video"; title: string }) {
  return (
    <View style={st.root}>
      <Text style={st.title}>{title}</Text>
      <Text style={st.text}>Calls run in the installed Android or iPhone app. In a browser, use the Diwakar Connect website.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={st.button}>
        <Text style={st.buttonText}>Back</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.charcoal, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  title: { color: colors.white, fontSize: 20, fontWeight: "700" },
  text: { color: colors.ink300, fontSize: 15, textAlign: "center" },
  button: { backgroundColor: colors.brand600, borderRadius: 12, paddingHorizontal: 20, height: 44, justifyContent: "center" },
  buttonText: { color: colors.white, fontWeight: "700" },
});
