import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Hash, Lock, Users } from "lucide-react-native";
import type { RpcRow } from "@/lib/database.types";
import { friendlyError, supabase } from "@/lib/supabase";
import { useActivity } from "@/providers/activity";
import { CountBadge, EmptyState, Loading } from "@/components/ui";
import { colors } from "@/theme";

type Channel = RpcRow<"list_my_channels">;

/** My teams and their channels (department and project teams), with unread counts. */
export default function Teams() {
  const { messageTick } = useActivity();
  const [rows, setRows] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("list_my_channels");
    if (e) return setError(friendlyError(e, "Couldn't load your teams."));
    setError(null);
    setRows((data ?? []).filter((c) => !c.channel_archived && !c.team_archived));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set when the request resolves
    if (messageTick) void load();
  }, [load, messageTick]);

  if (error && !rows) return <EmptyState title="Couldn't load teams" description={error} />;
  if (!rows) return <Loading />;

  const byTeam = new Map<string, { title: string; data: Channel[] }>();
  for (const c of rows) {
    const t = byTeam.get(c.team_id) ?? { title: c.team_name, data: [] };
    t.data.push(c);
    byTeam.set(c.team_id, t);
  }
  const sections = Array.from(byTeam.values())
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => ({ ...t, data: t.data.sort((a, b) => Number(b.is_general) - Number(a.is_general) || a.channel_name.localeCompare(b.channel_name)) }));

  return (
    <SectionList
      style={{ backgroundColor: colors.white }}
      sections={sections}
      keyExtractor={(c) => c.channel_id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.brand600}
          colors={[colors.brand600]}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListEmptyComponent={<EmptyState icon={<Users color={colors.brand600} size={24} />} title="No teams yet" description="You'll see your department and project teams here once you're added. Teams are created on the website." />}
      contentContainerStyle={sections.length === 0 ? { flexGrow: 1 } : { paddingBottom: 24 }}
      renderSectionHeader={({ section }) => (
        <View style={st.section}>
          <View style={st.teamIcon}>
            <Text style={st.teamLetter}>{section.title.slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={st.sectionTitle}>{section.title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.conversation_id } })}
          style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.canvas }]}
        >
          {item.channel_visibility === "private" ? <Lock size={18} color={colors.ink500} /> : <Hash size={18} color={colors.ink500} />}
          <Text style={[st.name, item.unread_count > 0 && { fontWeight: "700", color: colors.ink900 }]} numberOfLines={1}>
            {item.channel_name}
          </Text>
          <CountBadge count={item.unread_count} />
        </Pressable>
      )}
    />
  );
}

const st = StyleSheet.create({
  section: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6, backgroundColor: colors.white },
  teamIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center" },
  teamLetter: { fontWeight: "700", color: colors.brand700 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.ink900 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingLeft: 56, paddingRight: 16 },
  name: { flex: 1, fontSize: 15, color: colors.ink700 },
});
