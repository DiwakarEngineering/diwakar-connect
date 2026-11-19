import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Download, FileText, Pause, Play } from "lucide-react-native";
import { fileSize } from "@/lib/format";
import { signedUrl, useSignedUrl } from "@/lib/storage";
import { colors } from "@/theme";
import type { Attachment } from "./use-conversation";

function ImageAttachment({ a }: { a: Attachment }) {
  const url = useSignedUrl("attachments", a.object_path, 300);
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open image ${a.file_name}`} onPress={() => url && void WebBrowser.openBrowserAsync(url)}>
      {url ? (
        <Image source={{ uri: url }} style={st.image} contentFit="cover" transition={150} />
      ) : (
        <View style={[st.image, { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink100 }]}>
          <ActivityIndicator color={colors.brand600} />
        </View>
      )}
    </Pressable>
  );
}

function AudioAttachment({ a, own }: { a: Attachment; own: boolean }) {
  const url = useSignedUrl("attachments", a.object_path, 300);
  const player = useAudioPlayer(url ? { uri: url } : null);
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const secs = Math.round((playing || status.currentTime > 0 ? status.currentTime : status.duration) || 0);
  const fg = own ? colors.white : colors.ink900;
  return (
    <View style={[st.audio, own && { backgroundColor: "rgba(255,255,255,0.18)" }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
        disabled={!url}
        onPress={() => {
          if (playing) player.pause();
          else {
            if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.2)) void player.seekTo(0);
            player.play();
          }
        }}
        style={[st.play, { backgroundColor: own ? colors.white : colors.brand600 }]}
      >
        {playing ? <Pause size={18} color={own ? colors.brand600 : colors.white} /> : <Play size={18} color={own ? colors.brand600 : colors.white} />}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[st.audioTitle, { color: fg }]}>{a.file_name.startsWith("Voice message") ? "Voice message" : a.file_name}</Text>
        <Text style={[st.audioTime, { color: own ? colors.brand100 : colors.ink500 }]}>
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </Text>
      </View>
    </View>
  );
}

function FileAttachment({ a, own }: { a: Attachment; own: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${a.file_name}`}
      onPress={async () => {
        setBusy(true);
        const url = await signedUrl("attachments", a.object_path, 300);
        setBusy(false);
        if (url) void WebBrowser.openBrowserAsync(url);
      }}
      style={[st.file, own && { backgroundColor: "rgba(255,255,255,0.18)", borderColor: "transparent" }]}
    >
      <View style={[st.fileIcon, own && { backgroundColor: colors.white }]}>
        <FileText size={18} color={colors.brand600} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[st.fileName, own && { color: colors.white }]} numberOfLines={1}>
          {a.file_name}
        </Text>
        <Text style={[st.fileSize, own && { color: colors.brand100 }]}>{fileSize(a.size_bytes)}</Text>
      </View>
      {busy ? <ActivityIndicator color={own ? colors.white : colors.brand600} /> : <Download size={18} color={own ? colors.white : colors.ink500} />}
    </Pressable>
  );
}

export function AttachmentList({ items, own }: { items: Attachment[]; own: boolean }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      {items.map((a) =>
        a.mime_type.startsWith("image/") && a.mime_type !== "image/heic" ? (
          <ImageAttachment key={a.id} a={a} />
        ) : a.mime_type.startsWith("audio/") ? (
          <AudioAttachment key={a.id} a={a} own={own} />
        ) : (
          <FileAttachment key={a.id} a={a} own={own} />
        ),
      )}
    </View>
  );
}

const st = StyleSheet.create({
  image: { width: 220, height: 220, borderRadius: 14 },
  audio: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 200, padding: 8, borderRadius: 14, backgroundColor: colors.white },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  audioTitle: { fontSize: 14, fontWeight: "600" },
  audioTime: { fontSize: 12 },
  file: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 210, padding: 10, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  fileIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 14, fontWeight: "600", color: colors.ink900 },
  fileSize: { fontSize: 12, color: colors.ink500 },
});
