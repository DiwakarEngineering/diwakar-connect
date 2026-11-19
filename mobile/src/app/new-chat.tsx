import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Check, X } from "lucide-react-native";
import type { RpcRow } from "@/lib/database.types";
import { friendlyError, supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { Avatar, Button, EmptyState } from "@/components/ui";
import { colors } from "@/theme";

type Person = RpcRow<"search_directory">;

/**
 * New chat: pick one colleague for a direct chat or several for a group.
 * Existing chats are reused (direct chats are unique per pair; groups with
 * exactly the same members are found first) so nothing is duplicated.
 */
export default function NewChat() {
  const { userId } = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_directory", { p_query: query.trim() || null, p_limit: 40 });
      setResults((data ?? []).filter((p) => p.employment_status === "active" && p.id !== userId));
    }, query ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, userId]);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const toggle = (p: Person) => setPicked((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p].slice(0, 99)));

  async function start() {
    if (!picked.length) return;
    setBusy(true);
    let id: string | null = null;
    let error: { message?: string } | null = null;
    if (picked.length === 1) {
      const r = await supabase.rpc("get_or_create_direct_conversation", { p_other_user: picked[0]!.id });
      id = r.data;
      error = r.error;
    } else {
      const found = await supabase.rpc("find_group_conversation", { p_member_ids: picked.map((p) => p.id) });
      if (!found.error && found.data) id = found.data;
      else {
        const r = await supabase.rpc("create_group_conversation", { p_member_ids: picked.map((p) => p.id), p_title: groupName.trim() || null });
        id = r.data;
        error = r.error;
      }
    }
    setBusy(false);
    if (!id) {
      Alert.alert("Couldn't start the chat", friendlyError(error));
      return;
    }
    router.replace({ pathname: "/chat/[id]", params: { id } });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <View style={st.to}>
        <Text style={st.toLabel}>To:</Text>
        <View style={st.chips}>
          {picked.map((p) => (
            <Pressable key={p.id} accessibilityLabel={`Remove ${p.display_name}`} onPress={() => toggle(p)} style={st.chip}>
              <Text style={st.chipText} numberOfLines={1}>{p.display_name}</Text>
              <X size={14} color={colors.brand700} />
            </Pressable>
          ))}
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={picked.length ? "Add more people" : "Type a name"}
            placeholderTextColor={colors.ink400}
            style={st.toInput}
            accessibilityLabel="To"
            autoCorrect={false}
          />
        </View>
      </View>
      {picked.length > 1 ? (
        <View style={st.groupName}>
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            maxLength={80}
            placeholder="Group name (optional)"
            placeholderTextColor={colors.ink400}
            style={st.groupInput}
            accessibilityLabel="Group name"
          />
        </View>
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<EmptyState title={query ? "No one matches" : "Searching the directory..."} />}
        contentContainerStyle={results.length === 0 ? { flexGrow: 1 } : undefined}
        renderItem={({ item }) => {
          const on = pickedIds.has(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => {
                toggle(item);
                setQuery("");
              }}
              style={[st.row, on && { backgroundColor: colors.brand50 }]}
            >
              <Avatar name={item.display_name} path={item.avatar_path} userId={item.id} availability={item.availability} showPresence size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={st.name} numberOfLines={1}>{item.display_name}</Text>
                <Text style={st.sub} numberOfLines={1}>{[item.title, item.department_name].filter(Boolean).join(" · ") || "Employee"}</Text>
              </View>
              <View style={[st.check, on && { backgroundColor: colors.brand600, borderColor: colors.brand600 }]}>{on ? <Check size={14} color={colors.white} /> : null}</View>
            </Pressable>
          );
        }}
      />
      <View style={st.footer}>
        <Button
          title={picked.length > 1 ? `Start group chat (${picked.length})` : "Start chat"}
          onPress={() => void start()}
          disabled={!picked.length}
          loading={busy}
        />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  to: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: colors.brand500 },
  toLabel: { fontSize: 15, fontWeight: "700", color: colors.ink700, marginTop: 8 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand50, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 200 },
  chipText: { color: colors.brand800, fontSize: 14, flexShrink: 1 },
  toInput: { flexGrow: 1, minWidth: 120, height: 36, fontSize: 16, color: colors.ink900 },
  groupName: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  groupInput: { height: 40, fontSize: 15, color: colors.ink900 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  sub: { fontSize: 13, color: colors.ink500 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.ink300, alignItems: "center", justifyContent: "center" },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.line },
});
