import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { AtSign, Bell, Check, CornerUpLeft, ExternalLink, LogOut, Phone, Users } from "lucide-react-native";
import type { Enums, Tables } from "@/lib/database.types";
import { relativeTime } from "@/lib/format";
import { config } from "@/lib/config";
import { friendlyError, supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { useActivity } from "@/providers/activity";
import { Avatar, Button } from "@/components/ui";
import { AVAILABILITY, colors } from "@/theme";

const ICONS = { mention: AtSign, reply: CornerUpLeft, team_invite: Users, call: Phone, system: Bell } as const;

/** Profile, availability, status message, recent notifications and sign out. */
export default function Me() {
  const { userId, profile, email, role, setProfile, signOut } = useSession();
  const { refresh } = useActivity();
  const [status, setStatus] = useState(profile.status_message ?? "");
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<Tables<"notifications">[]>([]);

  const loadNotes = useCallback(async () => {
    const { data } = await supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
    setNotes(data ?? []);
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      void loadNotes();
    }, [loadNotes]),
  );

  async function update(patch: Partial<Pick<Tables<"profiles">, "availability" | "status_message">>) {
    setSaving(true);
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", userId).select("*").single();
    setSaving(false);
    if (error || !data) {
      Alert.alert("Couldn't save", friendlyError(error));
      return;
    }
    setProfile(data);
  }

  async function openNote(n: Tables<"notifications">) {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      refresh();
      void loadNotes();
    }
    if (n.conversation_id) router.push({ pathname: "/chat/[id]", params: { id: n.conversation_id } });
  }

  async function markAll() {
    await supabase.rpc("mark_all_notifications_read");
    refresh();
    void loadNotes();
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <View style={st.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Avatar name={profile.display_name} path={profile.avatar_path} userId={userId} availability={profile.availability} showPresence size="lg" />
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{profile.display_name}</Text>
            {profile.title ? <Text style={st.sub}>{profile.title}</Text> : null}
            <Text style={st.sub}>{email}</Text>
          </View>
        </View>
        <Text style={st.hint}>
          Role: {role[0]!.toUpperCase() + role.slice(1)}. Change your name and photo on the website under Settings.
        </Text>
      </View>

      <View style={st.card}>
        <Text style={st.heading}>Availability</Text>
        {(Object.keys(AVAILABILITY) as Enums<"availability">[]).map((a) => (
          <Pressable
            key={a}
            accessibilityRole="radio"
            accessibilityState={{ checked: profile.availability === a }}
            onPress={() => void update({ availability: a })}
            disabled={saving}
            style={st.option}
          >
            <View style={[st.dot, { backgroundColor: AVAILABILITY[a].color }]} />
            <Text style={st.optionText}>{AVAILABILITY[a].label}</Text>
            {profile.availability === a ? <Check size={18} color={colors.brand600} /> : null}
          </Pressable>
        ))}
        <Text style={[st.heading, { marginTop: 10 }]}>Status message</Text>
        <TextInput
          value={status}
          onChangeText={setStatus}
          maxLength={140}
          placeholder="e.g. At Bhojusar site until 3 pm"
          placeholderTextColor={colors.ink400}
          style={st.input}
          accessibilityLabel="Status message"
        />
        <Button
          title="Save status"
          variant="secondary"
          onPress={() => void update({ status_message: status.trim() || null })}
          disabled={saving || (status.trim() || null) === (profile.status_message ?? null)}
        />
      </View>

      <View style={st.card}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[st.heading, { flex: 1 }]}>Notifications</Text>
          {notes.some((n) => !n.read_at) ? (
            <Pressable onPress={() => void markAll()} hitSlop={8}>
              <Text style={st.link}>Mark all read</Text>
            </Pressable>
          ) : null}
        </View>
        {notes.length === 0 ? <Text style={st.sub}>No notifications yet.</Text> : null}
        {notes.map((n) => {
          const Icon = ICONS[n.kind];
          return (
            <Pressable key={n.id} accessibilityRole="button" onPress={() => void openNote(n)} style={st.note}>
              <View style={[st.noteIcon, !n.read_at && { backgroundColor: colors.brand50 }]}>
                <Icon size={16} color={n.read_at ? colors.ink400 : colors.brand600} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.noteTitle, !n.read_at && { fontWeight: "700" }]} numberOfLines={2}>{n.title}</Text>
                {n.body ? <Text style={st.sub} numberOfLines={1}>{n.body}</Text> : null}
                <Text style={st.time}>{relativeTime(n.created_at)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={st.card}>
        <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(`${config.siteUrl}/settings`)} style={st.option}>
          <ExternalLink size={18} color={colors.ink600} />
          <Text style={st.optionText}>Profile, password and notification settings</Text>
        </Pressable>
        <Button
          title="Sign out"
          variant="secondary"
          icon={<LogOut size={18} color={colors.ink800} />}
          onPress={() =>
            Alert.alert("Sign out?", "You'll need your email and password to sign in again.", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void signOut() },
            ])
          }
        />
      </View>
      <Text style={st.version}>Diwakar Connect {Constants.expoConfig?.version ?? ""}</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 8 },
  name: { fontSize: 19, fontWeight: "700", color: colors.ink900 },
  sub: { fontSize: 13, color: colors.ink500 },
  hint: { fontSize: 12, color: colors.ink500, marginTop: 6 },
  heading: { fontSize: 15, fontWeight: "700", color: colors.ink900 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  optionText: { flex: 1, fontSize: 15, color: colors.ink800 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  input: { height: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, color: colors.ink900 },
  link: { color: colors.brand700, fontWeight: "600", fontSize: 13 },
  note: { flexDirection: "row", gap: 12, paddingVertical: 8 },
  noteIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ink100, alignItems: "center", justifyContent: "center" },
  noteTitle: { fontSize: 14, color: colors.ink900 },
  time: { fontSize: 11, color: colors.ink400, marginTop: 2 },
  version: { textAlign: "center", fontSize: 12, color: colors.ink400 },
});
