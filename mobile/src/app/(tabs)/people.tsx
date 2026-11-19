import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MessageSquare, Search } from "lucide-react-native";
import type { RpcRow } from "@/lib/database.types";
import { friendlyError, supabase } from "@/lib/supabase";
import { openDirectChat } from "@/lib/open-chat";
import { useSession } from "@/providers/session";
import { usePresenceState } from "@/providers/presence";
import { Avatar, EmptyState, Loading } from "@/components/ui";
import { colors } from "@/theme";

type Entry = RpcRow<"search_directory">;

/** Company directory (same visibility rules as the website); tap someone to chat. */
export default function People() {
  const { userId } = useSession();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data, error: e } = await supabase.rpc("search_directory", { p_query: query.trim() || null, p_limit: 100 });
      if (e) return setError(friendlyError(e, "Couldn't load the directory."));
      setError(null);
      setRows((data ?? []).filter((p) => p.employment_status === "active"));
    }, query ? 220 : 0);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={st.top}>
        <View style={st.searchBox}>
          <Search size={18} color={colors.ink400} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, title or department"
            placeholderTextColor={colors.ink400}
            style={st.searchInput}
            accessibilityLabel="Search people"
            autoCorrect={false}
          />
        </View>
      </View>
      {error && !rows ? (
        <EmptyState title="Couldn't load the directory" description={error} />
      ) : !rows ? (
        <Loading />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState title="No one matches" />}
          contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={st.sep} />}
          renderItem={({ item }) => <PersonRow p={item} me={userId} />}
        />
      )}
    </View>
  );
}

function PersonRow({ p, me }: { p: Entry; me: string }) {
  const presence = usePresenceState(p.id, p.availability);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens a chat"
      onPress={() => void openDirectChat(p.id)}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.canvas }]}
    >
      <Avatar name={p.display_name} path={p.avatar_path} userId={p.id} availability={p.availability} showPresence />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.name} numberOfLines={1}>
          {p.display_name}
          {p.id === me ? " (you)" : ""}
        </Text>
        <Text style={st.sub} numberOfLines={1}>
          {[p.title, p.department_name].filter(Boolean).join(" · ") || "Employee"}
        </Text>
        <Text style={[st.status, { color: presence.online ? presence.color : colors.ink400 }]} numberOfLines={1}>
          {presence.label}
          {p.status_message ? ` · ${p.status_message}` : ""}
        </Text>
      </View>
      <MessageSquare size={20} color={colors.brand600} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, height: 42, borderRadius: 12, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink900 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  name: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  sub: { fontSize: 13, color: colors.ink500 },
  status: { fontSize: 12, fontWeight: "500" },
  sep: { height: 1, backgroundColor: colors.line, marginLeft: 72 },
});
