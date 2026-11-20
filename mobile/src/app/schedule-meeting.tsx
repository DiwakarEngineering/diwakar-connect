import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Check, X } from "lucide-react-native";
import type { RpcRow } from "@/lib/database.types";
import { friendlyError, supabase } from "@/lib/supabase";
import { useSession, useSessionState } from "@/providers/session";
import { Avatar, Button } from "@/components/ui";
import { colors } from "@/theme";

type Person = RpcRow<"search_directory">;

const DAY = 24 * 60 * 60_000;
const DURATIONS = [15, 30, 45, 60, 90, 120];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Schedule a meeting: title, day, start time, length, invitees, agenda, guests. */
export default function ScheduleMeeting() {
  const { userId } = useSession();
  const { state } = useSessionState();
  const guestsAllowed = state.status === "ready" && !!state.settings?.allow_guest_meetings;

  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => new Date(today.getTime() + i * DAY)), [today]);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(0);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [length, setLength] = useState(30);
  const [agenda, setAgenda] = useState("");
  const [allowGuests, setAllowGuests] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [nowMs] = useState(() => Date.now());

  // Start times every 15 minutes; today only from the next quarter hour.
  const times = useMemo(() => {
    const out: number[] = [];
    const base = days[day]!.getTime();
    for (let m = 6 * 60; m <= 22 * 60; m += 15) if (base + m * 60_000 > nowMs) out.push(m);
    return out;
  }, [day, days, nowMs]);
  const chosen = minutes !== null && times.includes(minutes) ? minutes : (times[0] ?? null);

  useEffect(() => {
    if (!query.trim()) {
      const t = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_directory", { p_query: query.trim(), p_limit: 20 });
      setResults((data ?? []).filter((p) => p.employment_status === "active" && p.id !== userId));
    }, 200);
    return () => clearTimeout(t);
  }, [query, userId]);

  const label = (m: number) => {
    const d = new Date(today);
    d.setHours(Math.floor(m / 60), m % 60);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };

  async function save() {
    if (!title.trim()) return Alert.alert("Add a title", "Give the meeting a short title.");
    if (chosen === null) return Alert.alert("Pick a start time");
    const start = new Date(days[day]!.getTime() + chosen * 60_000);
    setBusy(true);
    const { data, error } = await supabase.rpc("create_meeting", {
      p_title: title.trim(),
      p_starts_at: start.toISOString(),
      p_ends_at: new Date(start.getTime() + length * 60_000).toISOString(),
      p_invitee_ids: picked.map((p) => p.id),
      p_description: agenda.trim() || null,
      p_allow_guests: guestsAllowed && allowGuests,
    });
    setBusy(false);
    if (error || !data) return Alert.alert("Couldn't schedule the meeting", friendlyError(error));
    router.replace({ pathname: "/meeting/[id]", params: { id: data } });
  }

  return (
    <ScrollView style={{ backgroundColor: colors.white }} contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
      <Text style={st.label}>Title</Text>
      <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Weekly site review" placeholderTextColor={colors.ink400} style={st.input} accessibilityLabel="Title" />

      <Text style={st.label}>Day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
        {days.map((d, i) => (
          <Pressable key={i} accessibilityRole="button" accessibilityState={{ selected: day === i }} onPress={() => setDay(i)} style={[st.dayChip, day === i && st.on]}>
            <Text style={[st.dayTop, day === i && st.onText]}>{i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString(undefined, { weekday: "short" })}</Text>
            <Text style={[st.dayNum, day === i && st.onText]}>{d.getDate()}</Text>
            <Text style={[st.dayTop, day === i && st.onText]}>{d.toLocaleDateString(undefined, { month: "short" })}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={st.label}>Start time</Text>
      {times.length === 0 ? (
        <Text style={st.muted}>No more start times today. Pick another day.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
          {times.map((m) => (
            <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: chosen === m }} onPress={() => setMinutes(m)} style={[st.chip, chosen === m && st.on]}>
              <Text style={[st.chipText, chosen === m && st.onText]}>{label(m)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Text style={st.label}>Length</Text>
      <View style={st.wrap}>
        {DURATIONS.map((m) => (
          <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: length === m }} onPress={() => setLength(m)} style={[st.chip, length === m && st.on]}>
            <Text style={[st.chipText, length === m && st.onText]}>{m < 60 ? `${m} min` : m === 60 ? "1 hour" : `${m / 60} hours`}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={st.label}>Invite people</Text>
      {picked.length ? (
        <View style={st.wrap}>
          {picked.map((p) => (
            <Pressable key={p.id} accessibilityLabel={`Remove ${p.display_name}`} onPress={() => setPicked((l) => l.filter((x) => x.id !== p.id))} style={st.person}>
              <Text style={st.personText} numberOfLines={1}>{p.display_name}</Text>
              <X size={14} color={colors.brand700} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput value={query} onChangeText={setQuery} placeholder="Search colleagues by name" placeholderTextColor={colors.ink400} style={st.input} accessibilityLabel="Invite people" autoCorrect={false} />
      {results.map((p) => {
        const on = picked.some((x) => x.id === p.id);
        return (
          <Pressable
            key={p.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => {
              setPicked((l) => (on ? l.filter((x) => x.id !== p.id) : [...l, p]));
              setQuery("");
            }}
            style={st.result}
          >
            <Avatar name={p.display_name} path={p.avatar_path} userId={p.id} availability={p.availability} showPresence size="sm" />
            <View style={{ flex: 1 }}>
              <Text style={st.resultName} numberOfLines={1}>{p.display_name}</Text>
              <Text style={st.muted} numberOfLines={1}>{[p.title, p.department_name].filter(Boolean).join(" · ") || "Employee"}</Text>
            </View>
            {on ? <Check size={18} color={colors.brand600} /> : null}
          </Pressable>
        );
      })}

      <Text style={st.label}>Agenda (optional)</Text>
      <TextInput value={agenda} onChangeText={setAgenda} maxLength={2000} multiline placeholder="What will you discuss?" placeholderTextColor={colors.ink400} style={[st.input, { height: 96, paddingTop: 12, textAlignVertical: "top" }]} accessibilityLabel="Agenda" />

      {guestsAllowed ? (
        <View style={st.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.resultName}>Allow external guests</Text>
            <Text style={st.muted}>People without a Diwakar account can ask to join with the ID and passcode; you admit them.</Text>
          </View>
          <Switch value={allowGuests} onValueChange={setAllowGuests} trackColor={{ true: colors.brand500 }} accessibilityLabel="Allow external guests" />
        </View>
      ) : null}

      <Button title="Schedule meeting" onPress={() => void save()} loading={busy} style={{ marginTop: 12 }} />
      <Text style={[st.muted, { textAlign: "center" }]}>Invitees get a notification, and a reminder 15 minutes before the start.</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 14, fontWeight: "700", color: colors.ink800, marginTop: 10 },
  muted: { fontSize: 13, color: colors.ink500 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: colors.ink900, backgroundColor: colors.white },
  chips: { gap: 8, paddingVertical: 2 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayChip: { width: 62, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: "center" },
  dayTop: { fontSize: 12, color: colors.ink500 },
  dayNum: { fontSize: 20, fontWeight: "700", color: colors.ink900 },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.ink800 },
  on: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  onText: { color: colors.white },
  person: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand50, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 220 },
  personText: { color: colors.brand800, fontSize: 14, flexShrink: 1 },
  result: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  resultName: { fontSize: 15, fontWeight: "600", color: colors.ink900 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
});
