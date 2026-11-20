import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { CalendarDays, CalendarPlus, Hash, Users, Video, Zap } from "lucide-react-native";
import { friendlyError, supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { usePeopleById } from "@/providers/people";
import { EmptyState, Loading } from "@/components/ui";
import { colors } from "@/theme";
import { RESPONSE_LABEL, joinMeetingCall, joinable, meetNow, timeText, type MeetingRow } from "./meetings";

const DAY = 24 * 60 * 60_000;

function dayTitle(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** My meetings for the next two weeks (and any still live), grouped by day, with Meet now / Schedule / Join with ID. */
export function MeetingsList() {
  const { userId, profile } = useSession();
  const [rows, setRows] = useState<MeetingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canSchedule, setCanSchedule] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const { data, error: e } = await supabase.rpc("list_my_meetings", {
      p_from: from.toISOString(),
      p_to: new Date(from.getTime() + 15 * DAY).toISOString(),
    });
    if (e) return setError(friendlyError(e, "Couldn't load your meetings."));
    setRows((data ?? []).filter((m) => !m.cancelled_at || new Date(m.ends_at).getTime() > Date.now()));
    setError(null);
    setNow(Date.now());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void supabase.rpc("can_schedule_meetings").then(({ data }) => setCanSchedule(!!data));
    }, [load]),
  );

  // Live updates: invitations, changes, cancellations, calls starting; and the Join window opening.
  useEffect(() => {
    const channel = supabase
      .channel(`my-meetings:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => void load())
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(t);
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  const people = usePeopleById((rows ?? []).map((r) => r.organizer_id));

  async function startNow() {
    setStarting(true);
    const err = await meetNow(profile.display_name.split(" ")[0] ?? "me");
    setStarting(false);
    if (err) Alert.alert("Couldn't start a meeting", err);
  }

  const sections = (() => {
    const map = new Map<string, { title: string; data: MeetingRow[] }>();
    for (const m of rows ?? []) {
      const d = new Date(m.starts_at);
      d.setHours(0, 0, 0, 0);
      const key = String(d.getTime());
      if (!map.has(key)) map.set(key, { title: dayTitle(d), data: [] });
      map.get(key)!.data.push(m);
    }
    return Array.from(map.values());
  })();

  const header = (
    <View style={st.actions}>
      <Pressable
        accessibilityRole="button"
        disabled={!canSchedule || starting}
        onPress={() => void startNow()}
        style={({ pressed }) => [st.action, (!canSchedule || starting) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
      >
        <Zap size={18} color={colors.brand700} />
        <Text style={st.actionText}>{starting ? "Starting..." : "Meet now"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!canSchedule}
        onPress={() => router.push("/schedule-meeting")}
        style={({ pressed }) => [st.action, st.primary, !canSchedule && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
      >
        <CalendarPlus size={18} color={colors.white} />
        <Text style={[st.actionText, { color: colors.white }]}>Schedule</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/join-meeting")} style={({ pressed }) => [st.action, pressed && { opacity: 0.7 }]}>
        <Hash size={18} color={colors.brand700} />
        <Text style={st.actionText}>Join with ID</Text>
      </Pressable>
    </View>
  );

  if (error && !rows) return <EmptyState title="Couldn't load meetings" description={error} />;
  if (!rows) return <Loading />;

  return (
    <SectionList
      style={{ backgroundColor: colors.white }}
      sections={sections}
      keyExtractor={(m) => m.meeting_id}
      ListHeaderComponent={header}
      stickySectionHeadersEnabled={false}
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
          icon={<CalendarDays color={colors.brand600} size={24} />}
          title="No meetings in the next two weeks"
          description={canSchedule ? "Schedule a meeting or start one now." : "Meetings you're invited to appear here."}
        />
      }
      contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : { paddingBottom: 24 }}
      renderSectionHeader={({ section }) => <Text style={st.day}>{section.title}</Text>}
      renderItem={({ item }) => {
        const canJoin = joinable(item, now);
        const organizer = item.organizer_id === userId ? "You" : (item.organizer_id && people.get(item.organizer_id)?.display_name) || "Organizer";
        return (
          <View style={[st.card, item.live && st.liveCard]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${timeText(item.starts_at)}. Open details`}
              onPress={() => router.push({ pathname: "/meeting/[id]", params: { id: item.meeting_id } })}
              style={({ pressed }) => [{ flex: 1, gap: 3 }, pressed && { opacity: 0.6 }]}
            >
              <View style={st.line}>
                {item.live ? <Text style={st.live}>LIVE</Text> : null}
                <Text style={[st.title, item.cancelled_at && st.cancelled]} numberOfLines={2}>{item.title}</Text>
              </View>
              <Text style={st.sub}>
                {timeText(item.starts_at)} – {timeText(item.ends_at)}
                {item.cancelled_at ? " · Cancelled" : ""}
              </Text>
              <View style={st.line}>
                <Users size={13} color={colors.ink500} />
                <Text style={st.sub} numberOfLines={1}>
                  {organizer}
                  {item.invitee_count ? ` · ${item.invitee_count} invited` : ""}
                  {item.my_response && item.organizer_id !== userId ? ` · ${RESPONSE_LABEL[item.my_response]}` : ""}
                </Text>
              </View>
            </Pressable>
            {canJoin ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Join ${item.title}`} onPress={() => joinMeetingCall(item.conversation_id, item.title)} style={st.join}>
                <Video size={16} color={colors.white} />
                <Text style={st.joinText}>Join</Text>
              </Pressable>
            ) : null}
          </View>
        );
      }}
    />
  );
}

const st = StyleSheet.create({
  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  primary: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  actionText: { fontSize: 13, fontWeight: "700", color: colors.brand700 },
  day: { fontSize: 13, fontWeight: "700", color: colors.ink500, textTransform: "uppercase", letterSpacing: 0.4, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  liveCard: { borderColor: colors.brand300, backgroundColor: colors.brand50 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flexShrink: 1, fontSize: 16, fontWeight: "600", color: colors.ink900 },
  cancelled: { textDecorationLine: "line-through", color: colors.ink400 },
  live: { fontSize: 10, fontWeight: "800", color: colors.white, backgroundColor: colors.danger600, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: "hidden" },
  sub: { fontSize: 13, color: colors.ink500, flexShrink: 1 },
  join: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand600, paddingHorizontal: 14, height: 36, borderRadius: 18 },
  joinText: { color: colors.white, fontWeight: "700", fontSize: 13 },
});
