import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { File as FsFile } from "expo-file-system";
import { Mic, SendHorizontal, Trash2 } from "lucide-react-native";
import { colors } from "@/theme";
import type { LocalFile } from "./use-conversation";

const MAX_SECONDS = 300;

/** Tap to record a voice message (up to 5 minutes); send or discard. Stored as an .m4a attachment. */
export function VoiceButton({ onRecorded, onActive }: { onRecorded: (f: LocalFile) => void; onActive: (active: boolean) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  async function start() {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Microphone access needed", "Allow microphone access for Diwakar Connect in your phone's settings to send voice messages.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    onActive(true);
    const started = Date.now();
    setSecs(0);
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSecs(s);
      if (s >= MAX_SECONDS) void stop(true);
    }, 250);
  }

  async function stop(send: boolean) {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    setRecording(false);
    onActive(false);
    const uri = recorder.uri;
    if (!send || !uri) return;
    const file = new FsFile(uri);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
    onRecorded({ uri, name: `Voice message ${stamp}.m4a`, mimeType: "audio/mp4", size: file.size ?? 1 });
  }

  if (!recording) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Record a voice message" onPress={() => void start()} style={st.icon} hitSlop={6}>
        <Mic size={22} color={colors.ink500} />
      </Pressable>
    );
  }
  return (
    <View style={st.bar} accessibilityLabel="Recording voice message">
      <Pressable accessibilityRole="button" accessibilityLabel="Discard recording" onPress={() => void stop(false)} style={st.icon}>
        <Trash2 size={22} color={colors.danger600} />
      </Pressable>
      <View style={st.dot} />
      <Text style={st.time} accessibilityLiveRegion="polite">
        Recording {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Send voice message" onPress={() => void stop(true)} style={st.send}>
        <SendHorizontal size={20} color={colors.white} />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  bar: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger600 },
  time: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink800 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand600, alignItems: "center", justifyContent: "center" },
});
