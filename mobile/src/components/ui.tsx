import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import type { Enums } from "@/lib/database.types";
import { initials } from "@/lib/format";
import { useSignedUrl } from "@/lib/storage";
import { usePresenceState } from "@/providers/presence";
import { colors, paletteFor } from "@/theme";

const SIZES = { xs: 24, sm: 32, md: 44, lg: 56, xl: 88 } as const;

export function Avatar({
  name,
  path,
  userId,
  availability,
  showPresence,
  size = "md",
}: {
  name: string;
  path?: string | null;
  userId?: string;
  availability?: Enums<"availability">;
  showPresence?: boolean;
  size?: keyof typeof SIZES;
}) {
  const px = SIZES[size];
  const url = useSignedUrl("avatars", path, 3600);
  const presence = usePresenceState(userId, availability);
  const [bg, fg] = paletteFor(userId ?? name);
  const dot = Math.max(10, Math.round(px * 0.28));
  return (
    <View style={{ width: px, height: px }} accessible={false}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: px, height: px, borderRadius: px / 2 }} contentFit="cover" />
      ) : (
        <View style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: fg, fontWeight: "700", fontSize: px * 0.36 }}>{initials(name)}</Text>
        </View>
      )}
      {showPresence ? (
        <View
          accessibilityLabel={presence.label}
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            borderWidth: 2,
            borderColor: colors.white,
            backgroundColor: presence.online ? presence.color : colors.white,
            ...(presence.online ? null : { borderColor: colors.ink300 }),
          }}
        />
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
}) {
  const v = {
    primary: { bg: colors.brand600, fg: colors.white, border: colors.brand600 },
    secondary: { bg: colors.white, fg: colors.ink800, border: colors.line },
    danger: { bg: colors.danger600, fg: colors.white, border: colors.danger600 },
    ghost: { bg: "transparent", fg: colors.brand700, border: "transparent" },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: v.bg, borderColor: v.border, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon}
      <Text style={[s.buttonText, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, error, ...input }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.ink400}
        {...input}
        accessibilityLabel={label}
        style={[s.input, error ? { borderColor: colors.danger600 } : null, input.style]}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <View style={s.empty}>
      {icon ? <View style={s.emptyIcon}>{icon}</View> : null}
      <Text style={s.emptyTitle}>{title}</Text>
      {description ? <Text style={s.emptyText}>{description}</Text> : null}
      {action}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.empty}>
      <ActivityIndicator color={colors.brand600} />
      {label ? <Text style={s.emptyText}>{label}</Text> : null}
    </View>
  );
}

export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={s.badge} accessibilityLabel={`${count} unread`}>
      <Text style={s.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export function IconButton({ label, onPress, children, active, disabled }: { label: string; onPress: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [s.iconButton, active && { backgroundColor: colors.brand50 }, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  button: { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink800 },
  input: { height: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: colors.ink900, backgroundColor: colors.white },
  error: { fontSize: 13, color: colors.danger600 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.ink900, textAlign: "center" },
  emptyText: { fontSize: 14, color: colors.ink500, textAlign: "center", lineHeight: 20 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand600, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: "700" },
  iconButton: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
