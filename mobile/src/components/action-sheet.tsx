import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/theme";

export type SheetAction = { label: string; icon?: ReactNode; danger?: boolean; onPress: () => void };

/** Bottom sheet of actions (long-press menus). */
export function ActionSheet({ visible, title, actions, header, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; header?: ReactNode; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]} accessibilityViewIsModal>
        <View style={st.grabber} />
        {title ? <Text style={st.title} numberOfLines={1}>{title}</Text> : null}
        {header}
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.canvas }]}
          >
            {a.icon}
            <Text style={[st.label, a.danger && { color: colors.danger600 }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(14,20,34,0.4)" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingHorizontal: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.ink200, marginBottom: 8 },
  title: { fontSize: 13, fontWeight: "600", color: colors.ink500, paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12 },
  label: { fontSize: 16, color: colors.ink900 },
});
