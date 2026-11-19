import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from "lucide-react-native";
import type { Tables } from "@/lib/database.types";
import { duration, listTime } from "@/lib/format";
import { friendlyError, supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { usePeopleById } from "@/providers/people";
import { Avatar, EmptyState, Loading } from "@/components/ui";
import { colors } from "@/theme";

type Row = Tables<"calls"> & { joined: boolean };

/** Call history: calls in my chats (RLS), whether I joined, live calls to rejoin. */
export default function Calls() {
  const { userId } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [titles, setTitles] = useState<Map<string, { title: string; other: string | null }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [calls, mine, convs] = await Promise.all([
      supabase.from("calls").select("*").order("started_at", { ascending: false }).limit(100),
      supabase.from("call_participants").select("call_id").eq("user_id", userId).limit(500),
      supabase.rpc("list_my_conversations", { p_limit: 300 }),
    ]);
    if (calls.error) return setError(friendlyError(calls.error, "Couldn't load call history."));
    const joined = new Set((mine.data ?? []).map((p) => p.call_id));
    setRows((calls.data ?? []).map((c) => ({ ...c, joined: joined.has(c.id) })));
    setTitles(new Map((convs.data ?? []).map((c) => [c.conversation_id, { title: c.title, other: c.other_user_id }])));
    setError(null);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const people = usePeopleById((rows ?? []).map((r) => r.started_by).concat(Array.from(titles.values()).map((t) => t.other)));

  if (error && !rows) return <EmptyState title="Couldn't load calls" description={error} />;
  if (!rows) return <Loading />;

  return (
    <FlatList
      style={{ backgroundColor: colors.white }}
      data={rows}
      keyExtractor={(r) => r.id}
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
      ListEmptyComponent={<EmptyState icon={<Phone color={colors.brand600} size={24} />} title="No calls yet" description="Start an audio or video call from any chat." />}
      contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
      ItemSeparatorComponent={() => <View style={st.sep} />}
      renderItem={({ item }) => {
        const t = titles.get(item.conversation_id);
        const other = t?.other ? people.get(t.other) : undefined;
        const outgoing = item.started_by === userId;
        const missed = !outgoing && !item.joined && item.status === "ended";
        const live = item.status === "active";
        const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.conversation_id } })}
            style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.canvas }]}
          >
            <Avatar name={t?.title ?? "Call"} path={other?.avatar_path} userId={t?.other ?? item.conversation_id} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[st.title, missed && { color: colors.danger600 }]} numberOfLines={1}>{t?.title ?? "Team channel call"}</Text>
              <View style={st.line}>
                <Icon size={14} color={missed ? colors.danger600 : colors.ink500} />
                <Text style={st.sub}>
                  {live ? "Live now" : missed ? "Missed" : outgoing ? "Outgoing" : "Incoming"} · {item.media === "audio" ? "Audio" : "Video"}
                  {item.ended_at ? ` · ${duration(item.started_at, item.ended_at)}` : ""}
                </Text>
              </View>
            </View>
            {live ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Join call"
                onPress={() => router.push({ pathname: "/call/[conversationId]", params: { conversationId: item.conversation_id, media: item.media } })}
                style={st.join}
              >
                {item.media === "audio" ? <Phone size={16} color={colors.white} /> : <Video size={16} color={colors.white} />}
                <Text style={st.joinText}>Join</Text>
              </Pressable>
            ) : (
              <Text style={st.time}>{listTime(item.started_at)}</Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 16, fontWeight: "600", color: colors.ink900 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  sub: { fontSize: 13, color: colors.ink500 },
  time: { fontSize: 12, color: colors.ink400 },
  join: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.success600, paddingHorizontal: 12, height: 34, borderRadius: 17 },
  joinText: { color: colors.white, fontWeight: "700", fontSize: 13 },
  sep: { height: 1, backgroundColor: colors.line, marginLeft: 72 },
});
