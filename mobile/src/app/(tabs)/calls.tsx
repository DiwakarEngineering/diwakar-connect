import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MeetingsList } from "@/meetings/meetings-list";
import { CallHistory } from "@/meetings/call-history";
import { colors } from "@/theme";

/** Calls tab: meetings calendar (default) and call history. */
export default function Calls() {
  const [tab, setTab] = useState<"meetings" | "history">("meetings");
  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={st.switch} accessibilityRole="tablist">
        {(
          [
            ["meetings", "Meetings"],
            ["history", "Call history"],
          ] as const
        ).map(([id, label]) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={[st.tab, tab === id && st.on]}>
            <Text style={[st.tabText, tab === id && st.onText]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "meetings" ? <MeetingsList /> : <CallHistory />}
    </View>
  );
}

const st = StyleSheet.create({
  switch: { flexDirection: "row", marginHorizontal: 16, marginTop: 4, padding: 3, borderRadius: 12, backgroundColor: colors.ink100 },
  tab: { flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  on: { backgroundColor: colors.white, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.ink500 },
  onText: { color: colors.ink900 },
});
