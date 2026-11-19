import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { router, Stack, useFocusEffect } from "expo-router";
import { BellOff, CheckCheck, Hash, MessageSquarePlus, Pin, PinOff, Search, Star, StarOff, Users, Bell } from "lucide-react-native";
import type { RpcRow } from "@/lib/database.types";
import { listTime } from "@/lib/format";
import { friendlyError, supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { usePeopleById } from "@/providers/people";
import { useActivity } from "@/providers/activity";
import { ActionSheet } from "@/components/action-sheet";
import { Avatar, CountBadge, EmptyState, IconButton, Loading } from "@/components/ui";
import { colors } from "@/theme";

// Works with both the current and the upgraded database (favourites / channels arrive with the chat-workspace migration).
type Row = RpcRow<"list_my_conversations">;
type Filter = "all" | "unread" | "chats" | "channels";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "chats", label: "Chats" },
  { id: "channels", label: "Channels" },
];

export default function ChatList() {
  const { userId } = useSession();
  const { messageTick, refresh: refreshBadges } = useActivity();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("list_my_conversations", { p_search: search.trim() || null, p_limit: 300 });
    if (e) {
      setError(friendlyError(e, "Couldn't load chats."));
      return;
    }
    setError(null);
    setRows(data ?? []);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, messageTick]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const people = usePeopleById((rows ?? []).flatMap((r) => [r.other_user_id, r.last_sender_id]));

  const visible = useMemo(() => {
    let list = rows ?? [];
    if (filter === "unread") list = list.filter((r) => r.unread_count > 0);
    if (filter === "chats") list = list.filter((r) => r.kind !== "channel");
    if (filter === "channels") list = list.filter((r) => r.kind === "channel");
    if (filter === "all" && !search.trim()) {
      list = list.filter((r) => r.kind !== "channel" || r.unread_count > 0 || r.is_pinned || r.is_favorite || r.last_message_preview);
    }
    // Favourites first, then pinned, then most recent (the server already orders pinned/recent).
    return [...list].sort((a, b) => Number(!!b.is_favorite) - Number(!!a.is_favorite));
  }, [filter, rows, search]);

  async function setPref(row: Row, patch: { p_is_pinned?: boolean; p_is_muted?: boolean; p_is_favorite?: boolean }) {
    const { error: e } = await supabase.rpc("set_conversation_preferences", { p_conversation_id: row.conversation_id, ...patch });
    if (e) setError(friendlyError(e));
    void load();
    refreshBadges();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton label="New chat" onPress={() => router.push("/new-chat")}>
              <MessageSquarePlus color={colors.brand600} size={22} />
            </IconButton>
          ),
        }}
      />
      <View style={st.top}>
        <View style={st.searchBox}>
          <Search size={18} color={colors.ink400} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search chats and channels"
            placeholderTextColor={colors.ink400}
            style={st.searchInput}
            accessibilityLabel="Search chats and channels"
            returnKeyType="search"
          />
        </View>
        <View style={st.filters} accessibilityRole="tablist">
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === f.id }}
              onPress={() => setFilter(f.id)}
              style={[st.chip, filter === f.id && st.chipOn]}
            >
              <Text style={[st.chipText, filter === f.id && st.chipTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error && rows === null ? (
        <EmptyState title="Couldn't load chats" description={error} />
      ) : rows === null ? (
        <Loading />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.conversation_id}
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
          ListEmptyComponent={
            <EmptyState
              icon={<MessageSquarePlus color={colors.brand600} size={24} />}
              title={search ? "Nothing matches" : filter === "unread" ? "You're all caught up" : filter === "channels" ? "No channels yet" : "No chats yet"}
              description={!search && filter === "all" ? "Tap the new-chat button to message a colleague or a group." : undefined}
            />
          }
          renderItem={({ item }) => <ChatRow row={item} me={userId} people={people} onLongPress={() => setMenuFor(item)} />}
          ItemSeparatorComponent={() => <View style={st.sep} />}
          contentContainerStyle={visible.length === 0 ? { flexGrow: 1 } : undefined}
        />
      )}
      <ActionSheet
        visible={!!menuFor}
        title={menuFor?.title}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                ...(menuFor.is_favorite === undefined
                  ? []
                  : [
                      {
                        label: menuFor.is_favorite ? "Remove from favorites" : "Add to favorites",
                        icon: menuFor.is_favorite ? <StarOff size={20} color={colors.ink600} /> : <Star size={20} color={colors.ink600} />,
                        onPress: () => void setPref(menuFor, { p_is_favorite: !menuFor.is_favorite }),
                      },
                    ]),
                {
                  label: menuFor.is_pinned ? "Unpin" : "Pin to top",
                  icon: menuFor.is_pinned ? <PinOff size={20} color={colors.ink600} /> : <Pin size={20} color={colors.ink600} />,
                  onPress: () => void setPref(menuFor, { p_is_pinned: !menuFor.is_pinned }),
                },
                {
                  label: menuFor.is_muted ? "Unmute" : "Mute",
                  icon: menuFor.is_muted ? <Bell size={20} color={colors.ink600} /> : <BellOff size={20} color={colors.ink600} />,
                  onPress: () => void setPref(menuFor, { p_is_muted: !menuFor.is_muted }),
                },
                {
                  label: "Mark as read",
                  icon: <CheckCheck size={20} color={colors.ink600} />,
                  onPress: () =>
                    void supabase.rpc("mark_conversation_read", { p_conversation_id: menuFor.conversation_id }).then(() => {
                      void load();
                      refreshBadges();
                    }),
                },
              ]
            : []
        }
      />
    </View>
  );
}

function ChatRow({ row, me, people, onLongPress }: { row: Row; me: string; people: ReturnType<typeof usePeopleById>; onLongPress: () => void }) {
  const other = row.other_user_id ? people.get(row.other_user_id) : undefined;
  const sender = row.last_sender_id ? (row.last_sender_id === me ? "You" : people.get(row.last_sender_id)?.display_name?.split(" ")[0]) : undefined;
  const preview =
    row.last_message_preview === null
      ? row.kind === "channel"
        ? "No posts yet"
        : "No messages yet"
      : row.last_message_kind === "system"
        ? `${row.last_sender_id ? `${sender ?? "Someone"} ` : ""}${row.last_message_preview}`
        : row.kind !== "direct" || row.last_sender_id === me
          ? `${sender ?? "Someone"}: ${row.last_message_preview}`
          : row.last_message_preview;
  const unread = row.unread_count > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Long-press for options"
      onPress={() => router.push({ pathname: "/chat/[id]", params: { id: row.conversation_id } })}
      onLongPress={onLongPress}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.canvas }]}
    >
      {row.kind === "direct" ? (
        <Avatar name={row.title} path={other?.avatar_path} userId={row.other_user_id ?? undefined} availability={other?.availability} showPresence />
      ) : (
        <View style={[st.groupIcon, row.kind === "channel" ? { backgroundColor: colors.brand50, borderRadius: 14 } : null]}>
          {row.kind === "channel" ? <Hash size={20} color={colors.brand700} /> : <Users size={20} color="#2B4C9B" />}
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={st.line}>
          <Text style={[st.title, unread && { fontWeight: "700" }]} numberOfLines={1}>
            {row.title}
            {row.kind === "channel" && row.team_name ? <Text style={st.team}>{`  ·  ${row.team_name}`}</Text> : null}
          </Text>
          <Text style={[st.time, unread && { color: colors.brand700, fontWeight: "700" }]}>{listTime(row.last_message_at)}</Text>
        </View>
        <View style={st.line}>
          {row.is_favorite ? <Star size={13} color={colors.brand500} fill={colors.brand500} /> : null}
          {row.is_pinned ? <Pin size={13} color={colors.ink400} /> : null}
          {row.is_muted ? <BellOff size={13} color={colors.ink400} /> : null}
          <Text style={[st.preview, unread && { color: colors.ink800 }]} numberOfLines={1}>
            {preview}
          </Text>
          {unread && !row.is_muted ? <CountBadge count={row.unread_count} /> : null}
          {unread && row.is_muted ? <View style={st.mutedDot} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingBottom: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, height: 42, borderRadius: 12, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink900 },
  filters: { flexDirection: "row", gap: 6 },
  chip: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: colors.ink100, justifyContent: "center" },
  chipOn: { backgroundColor: colors.brand600 },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.ink600 },
  chipTextOn: { color: colors.white },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  groupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#E7EEFF", alignItems: "center", justifyContent: "center" },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink900 },
  team: { fontSize: 13, fontWeight: "400", color: colors.ink400 },
  time: { fontSize: 12, color: colors.ink400 },
  preview: { flex: 1, fontSize: 14, color: colors.ink500 },
  mutedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink300 },
  sep: { height: 1, backgroundColor: colors.line, marginLeft: 72 },
});
