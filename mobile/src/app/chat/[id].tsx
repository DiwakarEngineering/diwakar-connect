import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { AlertCircle, Camera, Copy, CornerUpLeft, Forward, Hash, Image as ImageIcon, Paperclip, Pencil, Phone, Pin, PinOff, SendHorizontal, Sticker as StickerIcon, Trash2, Users, Video, X } from "lucide-react-native";
import { dayLabel, messageTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session";
import { usePeopleById, type Person } from "@/providers/people";
import { usePresenceState } from "@/providers/presence";
import { useActivity } from "@/providers/activity";
import { ActionSheet, type SheetAction } from "@/components/action-sheet";
import { Avatar, EmptyState, IconButton, Loading } from "@/components/ui";
import { AttachmentList } from "@/chat/attachments";
import { STICKERS } from "@/chat/stickers";
import { VoiceButton } from "@/chat/voice-button";
import { useMessages, useMeta, useTyping, type LocalFile, type Message } from "@/chat/use-conversation";
import { colors } from "@/theme";

const QUICK = ["👍", "❤️", "😂", "🎉", "🙏", "👀"];
const MAX_MB_DEFAULT = 25;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const { meta, error } = useMeta(id, userId);
  if (error) return <EmptyState title="Conversation not available" description={error} />;
  if (!meta) return <Loading label="Opening conversation" />;
  return <Ready key={id} meta={meta} />;
}

function Ready({ meta }: { meta: NonNullable<ReturnType<typeof useMeta>["meta"]> }) {
  const { userId, isAdmin, settings } = useSession();
  const { refresh: refreshBadges } = useActivity();
  const insets = useSafeAreaInsets();
  const api = useMessages(meta.id, userId, meta.clearedAt);
  const { typingIds, notifyTyping, notifyStopped } = useTyping(meta.id, userId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [menu, setMenu] = useState<{ m: Message; at: number; actions: SheetAction[] } | null>(null);
  const menuFor = menu?.m ?? null;
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [receipts, setReceipts] = useState<Map<string, { read: string | null; delivered: string | null }>>(new Map());
  const inputRef = useRef<TextInputInstance>(null);

  const ids = useMemo(() => {
    const s = new Set(meta.memberIds);
    for (const m of api.ordered) if (m.sender_id) s.add(m.sender_id);
    return Array.from(s);
  }, [api.ordered, meta.memberIds]);
  const people = usePeopleById(ids);
  const other = meta.otherUserId ? people.get(meta.otherUserId) : undefined;
  const presence = usePresenceState(other?.id, other?.availability);

  const title =
    meta.kind === "channel"
      ? (meta.channelName ?? "Channel")
      : meta.kind === "direct"
        ? (other?.display_name ?? "Chat") + (meta.otherUserId === userId ? " (you)" : "")
        : meta.title ||
          meta.memberIds
            .filter((x) => x !== userId)
            .map((x) => people.get(x)?.display_name?.split(" ")[0])
            .filter(Boolean)
            .slice(0, 3)
            .join(", ") ||
          "Group chat";
  const subtitle = meta.kind === "direct" ? (other?.status_message ? `${presence.label} · ${other.status_message}` : presence.label) : meta.kind === "group" ? `${meta.memberIds.length} members` : (meta.teamName ?? "");

  // Read state: mark read whenever new messages arrive while this screen is open.
  const newest = api.ordered[0]?.id;
  useEffect(() => {
    const t = setTimeout(() => {
      void supabase.rpc("mark_conversation_read", { p_conversation_id: meta.id }).then(() => refreshBadges());
    }, 500);
    return () => clearTimeout(t);
  }, [meta.id, newest, refreshBadges]);

  // Sent / delivered / read ticks for my messages (direct and group chats).
  const loadReceipts = useCallback(async () => {
    if (meta.kind === "channel") return;
    const r = await supabase.rpc("get_message_receipts", { p_conversation_id: meta.id });
    if (!r.error) {
      setReceipts(new Map((r.data ?? []).map((x) => [x.user_id, { read: x.last_read_at, delivered: x.last_delivered_at }])));
      return;
    }
    const old = await supabase.rpc("get_read_receipts", { p_conversation_id: meta.id });
    setReceipts(new Map((old.data ?? []).map((x) => [x.user_id, { read: x.last_read_at, delivered: x.last_read_at }])));
  }, [meta.id, meta.kind]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set when the request resolves
    void loadReceipts();
    const t = setInterval(() => void loadReceipts(), 8000);
    return () => clearInterval(t);
  }, [loadReceipts, newest]);

  const others = meta.memberIds.filter((x) => x !== userId);
  const receiptFor = (m: Message): "sent" | "delivered" | "read" | null => {
    if (meta.kind === "channel" || m.sender_id !== userId || m.pending || m.failed || m.kind !== "user") return null;
    if (others.length === 0) return "read";
    const all = (k: "read" | "delivered") => others.every((u) => {
      const at = receipts.get(u)?.[k];
      return !!at && at >= m.created_at;
    });
    return all("read") ? "read" : all("delivered") ? "delivered" : "sent";
  };

  const maxBytes = (settings?.max_attachment_mb ?? MAX_MB_DEFAULT) * 1024 * 1024;
  function addFiles(list: LocalFile[]) {
    const ok = list.filter((f) => {
      if (f.size > maxBytes) {
        Alert.alert("File too large", `"${f.name}" is larger than ${settings?.max_attachment_mb ?? MAX_MB_DEFAULT} MB.`);
        return false;
      }
      return true;
    });
    setFiles((cur) => [...cur, ...ok].slice(0, 10));
  }

  async function pickImages(camera: boolean) {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
    if (!perm.granted) {
      Alert.alert("Camera access needed", "Allow camera access for Diwakar Connect in your phone's settings.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images", "videos"], quality: 0.8, allowsMultipleSelection: !camera, selectionLimit: 10 };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    addFiles(
      res.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `${a.type === "video" ? "Video" : "Photo"} ${new Date().toISOString().slice(0, 10)} ${i + 1}.${a.type === "video" ? "mp4" : "jpg"}`,
        mimeType: a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg"),
        size: a.fileSize ?? 1,
      })),
    );
  }

  async function pickDocuments() {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    addFiles(res.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? "application/octet-stream", size: a.size ?? 1 })));
  }

  async function submit() {
    const body = text.trim();
    if (editing) {
      if (!body) return;
      const target = editing;
      setEditing(null);
      setText("");
      try {
        await api.edit(target.id, body);
      } catch (e) {
        Alert.alert("Couldn't edit", e instanceof Error ? e.message : undefined);
      }
      return;
    }
    if (!body && files.length === 0) return;
    // Keep @mentions for members whose full name still appears in the text.
    const mentions = meta.memberIds.filter((m) => m !== userId && people.get(m) && body.includes(`@${people.get(m)!.display_name}`));
    const input = { body, mentions, replyToId: replyTo?.id ?? null, files };
    setText("");
    setFiles([]);
    setReplyTo(null);
    notifyStopped();
    try {
      await api.send(input);
    } catch (e) {
      Alert.alert("Message not sent", e instanceof Error ? e.message : undefined);
    }
  }

  async function sendQuick(extra: { sticker?: string; files?: LocalFile[] }) {
    try {
      await api.send({ body: "", mentions: [], replyToId: replyTo?.id ?? null, files: extra.files ?? [], sticker: extra.sticker ?? null });
      setReplyTo(null);
    } catch (e) {
      Alert.alert("Message not sent", e instanceof Error ? e.message : undefined);
    }
  }

  const editWindow = settings?.message_edit_window_minutes ?? null;
  const menuActions = (m: Message, now: number): SheetAction[] => {
    const own = m.sender_id === userId;
    const list: SheetAction[] = [];
    if (meta.canPost) list.push({ label: "Reply", icon: <CornerUpLeft size={20} color={colors.ink600} />, onPress: () => { setReplyTo(m); inputRef.current?.focus(); } });
    if (m.body) list.push({ label: "Copy text", icon: <Copy size={20} color={colors.ink600} />, onPress: () => void Clipboard.setStringAsync(m.body) });
    if (meta.canPost && api.supportsUpgrade())
      list.push(
        m.pinned_at
          ? { label: "Unpin", icon: <PinOff size={20} color={colors.ink600} />, onPress: () => void api.pin(m.id, false).catch((e: Error) => Alert.alert("Couldn't unpin", e.message)) }
          : { label: "Pin for everyone", icon: <Pin size={20} color={colors.ink600} />, onPress: () => void api.pin(m.id, true).catch((e: Error) => Alert.alert("Couldn't pin", e.message)) },
      );
    if (own && m.body && meta.canPost && (editWindow === null || now - new Date(m.created_at).getTime() < editWindow * 60_000))
      list.push({ label: "Edit", icon: <Pencil size={20} color={colors.ink600} />, onPress: () => { setEditing(m); setText(m.body); inputRef.current?.focus(); } });
    if ((own && (settings?.allow_message_delete ?? true)) || isAdmin)
      list.push({
        label: own ? "Delete" : "Delete (moderate)",
        danger: true,
        icon: <Trash2 size={20} color={colors.danger600} />,
        onPress: () =>
          Alert.alert("Delete message?", own ? "This removes the message and its files for everyone." : "This removes the message for everyone and is recorded in the audit log.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => void api.remove(m.id).catch((e: Error) => Alert.alert("Couldn't delete", e.message)) },
          ]),
      });
    return list;
  };

  const typingLabel = (() => {
    const names = typingIds.map((u) => people.get(u)?.display_name?.split(" ")[0]).filter(Boolean);
    if (!names.length) return null;
    return names.length === 1 ? `${names[0]} is typing...` : names.length === 2 ? `${names[0]} and ${names[1]} are typing...` : "Several people are typing...";
  })();

  const callTo = (media: "audio" | "video") => router.push({ pathname: "/call/[conversationId]", params: { conversationId: meta.id, media } });
  const canSend = (text.trim().length > 0 || files.length > 0) && !recording;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={st.headerTitle}>
              {meta.kind === "direct" ? (
                <Avatar name={title} path={other?.avatar_path} userId={other?.id} availability={other?.availability} showPresence size="sm" />
              ) : (
                <View style={st.headerIcon}>{meta.kind === "channel" ? <Hash size={16} color={colors.brand700} /> : <Users size={16} color={colors.brand700} />}</View>
              )}
              <View style={{ flexShrink: 1 }}>
                <Text style={st.headerName} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={st.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
              </View>
            </View>
          ),
          headerRight: () =>
            meta.kind === "channel" ? null : (
              <View style={{ flexDirection: "row" }}>
                <IconButton label="Start audio call" onPress={() => callTo("audio")} disabled={!meta.canPost}>
                  <Phone size={21} color={colors.brand600} />
                </IconButton>
                <IconButton label="Start video call" onPress={() => callTo("video")} disabled={!meta.canPost}>
                  <Video size={22} color={colors.brand600} />
                </IconButton>
              </View>
            ),
        }}
      />

      {api.status === "loading" ? (
        <Loading />
      ) : api.status === "error" ? (
        <EmptyState title="Couldn't load messages" description={api.error ?? undefined} />
      ) : (
        <FlatList
          inverted
          data={api.ordered}
          keyExtractor={(m) => m.id}
          onEndReached={() => void api.loadOlder()}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingVertical: 10 }}
          ListEmptyComponent={
            <View style={{ transform: [{ scaleY: -1 }] }}>
              <EmptyState title={meta.kind === "channel" ? `Welcome to #${title}` : "Say hello"} description={meta.kind === "direct" ? `This is the start of your conversation with ${title}.` : "Nothing here yet."} />
            </View>
          }
          renderItem={({ item, index }) => {
            const older = api.ordered[index + 1];
            const showDay = !older || new Date(older.created_at).toDateString() !== new Date(item.created_at).toDateString();
            const grouped = !!older && !showDay && older.sender_id === item.sender_id && older.kind === "user" && new Date(item.created_at).getTime() - new Date(older.created_at).getTime() < 5 * 60_000;
            return (
              <View>
                {showDay ? (
                  <View style={st.day}>
                    <Text style={st.dayText}>{dayLabel(item.created_at)}</Text>
                  </View>
                ) : null}
                <Bubble
                  m={item}
                  me={userId}
                  grouped={grouped}
                  showSender={meta.kind !== "direct"}
                  sender={item.sender_id ? people.get(item.sender_id) : undefined}
                  parent={item.reply_to_id ? api.messages.get(item.reply_to_id) : undefined}
                  parentName={(() => {
                    const p = item.reply_to_id ? api.messages.get(item.reply_to_id) : undefined;
                    return p?.sender_id ? people.get(p.sender_id)?.display_name : undefined;
                  })()}
                  reactions={api.reactions.get(item.id) ?? []}
                  attachments={api.attachments.get(item.id) ?? []}
                  receipt={receiptFor(item)}
                  onLongPress={() => {
                    if (item.deleted_at || item.pending || item.kind !== "user") return;
                    const at = Date.now();
                    setMenu({ m: item, at, actions: menuActions(item, at) });
                  }}
                  onReact={(emoji) => void api.react(item.id, emoji).catch((e: Error) => Alert.alert("Reaction not saved", e.message))}
                  onRetry={() => void api.retry(item.id)}
                  onDiscard={() => api.discard(item.id)}
                />
              </View>
            );
          }}
        />
      )}

      {typingLabel ? <Text style={st.typing} accessibilityLiveRegion="polite">{typingLabel}</Text> : null}

      {meta.canPost ? (
        <View style={[st.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {replyTo || editing ? (
            <View style={st.replyBar}>
              <View style={{ flex: 1 }}>
                <Text style={st.replyTitle}>{editing ? "Editing message" : `Replying to ${(replyTo?.sender_id && people.get(replyTo.sender_id)?.display_name) || "message"}`}</Text>
                <Text style={st.replyText} numberOfLines={1}>{(editing ?? replyTo)?.body || "Attachment"}</Text>
              </View>
              <IconButton label="Cancel" onPress={() => { setReplyTo(null); if (editing) { setEditing(null); setText(""); } }}>
                <X size={18} color={colors.ink500} />
              </IconButton>
            </View>
          ) : null}
          {files.length ? (
            <View style={st.files}>
              {files.map((f, i) => (
                <View key={`${f.uri}-${i}`} style={st.fileChip}>
                  <Text style={st.fileChipText} numberOfLines={1}>{f.name}</Text>
                  <Pressable accessibilityLabel={`Remove ${f.name}`} onPress={() => setFiles((all) => all.filter((_, j) => j !== i))} hitSlop={8}>
                    <X size={14} color={colors.ink500} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <View style={st.inputRow}>
            {recording ? null : (
              <>
                <IconButton label="Add attachment" onPress={() => setAttachOpen(true)}>
                  <Paperclip size={22} color={colors.ink500} />
                </IconButton>
                <View style={st.inputWrap}>
                  <TextInput
                    ref={inputRef}
                    value={text}
                    onChangeText={(v) => {
                      setText(v);
                      if (v.trim()) notifyTyping();
                    }}
                    placeholder={meta.kind === "channel" ? `Post in #${title}` : "Type a message"}
                    placeholderTextColor={colors.ink400}
                    multiline
                    maxLength={8000}
                    style={st.input}
                    accessibilityLabel="Message"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel="Stickers" onPress={() => setStickersOpen(true)} hitSlop={6} style={{ padding: 6 }}>
                    <StickerIcon size={20} color={colors.ink400} />
                  </Pressable>
                </View>
              </>
            )}
            {canSend || editing ? (
              <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Save edit" : "Send message"} onPress={() => void submit()} style={st.send}>
                <SendHorizontal size={20} color={colors.white} />
              </Pressable>
            ) : (
              <VoiceButton onActive={setRecording} onRecorded={(f) => void sendQuick({ files: [f] })} />
            )}
          </View>
        </View>
      ) : (
        <View style={[st.readOnly, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Text style={st.readOnlyText}>You can read this conversation but not post in it.</Text>
        </View>
      )}

      <ActionSheet
        visible={!!menuFor}
        onClose={() => setMenu(null)}
        header={
          menuFor && meta.canPost ? (
            <View style={st.quickRow}>
              {QUICK.map((e) => (
                <Pressable
                  key={e}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${e}`}
                  onPress={() => {
                    const target = menuFor;
                    setMenu(null);
                    void api.react(target.id, e).catch((err: Error) => Alert.alert("Reaction not saved", err.message));
                  }}
                  style={st.quick}
                >
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
        actions={menu?.actions ?? []}
      />
      <ActionSheet
        visible={attachOpen}
        title="Attach"
        onClose={() => setAttachOpen(false)}
        actions={[
          { label: "Photo or video", icon: <ImageIcon size={20} color={colors.ink600} />, onPress: () => void pickImages(false) },
          { label: "Take a photo", icon: <Camera size={20} color={colors.ink600} />, onPress: () => void pickImages(true) },
          { label: "Document", icon: <Paperclip size={20} color={colors.ink600} />, onPress: () => void pickDocuments() },
        ]}
      />
      <ActionSheet
        visible={stickersOpen}
        title="Stickers"
        onClose={() => setStickersOpen(false)}
        actions={[]}
        header={
          <View style={st.stickerGrid}>
            {STICKERS.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Send ${s.label} sticker`}
                onPress={() => {
                  setStickersOpen(false);
                  if (!api.supportsUpgrade()) {
                    Alert.alert("Stickers aren't available yet", "Stickers need the latest server update.");
                    return;
                  }
                  void sendQuick({ sticker: s.id });
                }}
              >
                <StickerView id={s.id} small />
              </Pressable>
            ))}
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}

function StickerView({ id, small }: { id: string; small?: boolean }) {
  const s = STICKERS.find((x) => x.id === id);
  if (!s) return <Text style={{ fontStyle: "italic", color: colors.ink400 }}>Sticker</Text>;
  const Icon = s.icon;
  const size = small ? 72 : 112;
  return (
    <View accessibilityLabel={`Sticker: ${s.label}`} style={{ width: size, height: size, borderRadius: 18, backgroundColor: s.bg, alignItems: "center", justifyContent: "center", gap: 4, padding: 6 }}>
      <Icon size={small ? 26 : 40} color={s.fg} strokeWidth={2.2} />
      <Text style={{ color: s.fg, fontWeight: "700", fontSize: small ? 10 : 12, textAlign: "center" }}>{s.label}</Text>
    </View>
  );
}

function Bubble({
  m,
  me,
  grouped,
  showSender,
  sender,
  parent,
  parentName,
  reactions,
  attachments,
  receipt,
  onLongPress,
  onReact,
  onRetry,
  onDiscard,
}: {
  m: Message;
  me: string;
  grouped: boolean;
  showSender: boolean;
  sender: Person | undefined;
  parent: Message | undefined;
  parentName: string | undefined;
  reactions: { user_id: string; emoji: string }[];
  attachments: ReturnType<typeof useMessages>["attachments"] extends Map<string, infer A> ? A : never;
  receipt: "sent" | "delivered" | "read" | null;
  onLongPress: () => void;
  onReact: (emoji: string) => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (m.kind === "system") {
    return (
      <View style={st.system}>
        <Text style={st.systemText}>
          {m.sender_id ? <Text style={{ fontWeight: "600" }}>{sender?.display_name ?? "Someone"} </Text> : null}
          {m.body} · {messageTime(m.created_at)}
        </Text>
      </View>
    );
  }
  const own = m.sender_id === me;
  const name = sender?.display_name ?? (m.sender_id ? "Former employee" : "Diwakar Connect");
  const grouped_r = new Map<string, number>();
  let mine = new Set<string>();
  for (const r of reactions) {
    grouped_r.set(r.emoji, (grouped_r.get(r.emoji) ?? 0) + 1);
    if (r.user_id === me) mine = new Set([...mine, r.emoji]);
  }
  const deleted = !!m.deleted_at;
  const stickerOnly = !!m.sticker && !m.body && attachments.length === 0;
  return (
    <View style={[st.msgRow, own ? { justifyContent: "flex-end" } : null, { marginTop: grouped ? 2 : 10 }]}>
      {!own ? <View style={{ width: 32 }}>{!grouped ? <Avatar name={name} path={sender?.avatar_path} userId={m.sender_id ?? undefined} size="sm" /> : null}</View> : null}
      <View style={{ maxWidth: "78%", alignItems: own ? "flex-end" : "flex-start" }}>
        {!own && showSender && !grouped ? <Text style={st.sender}>{name}</Text> : null}
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={300}
          accessibilityHint="Long-press for message options"
          style={[
            stickerOnly ? null : st.bubble,
            stickerOnly ? null : own ? st.bubbleOwn : st.bubbleOther,
            m.pending && { opacity: 0.65 },
          ]}
        >
          {m.pinned_at && !deleted ? (
            <View style={st.pinned}>
              <Pin size={11} color={own ? colors.brand100 : colors.brand700} />
              <Text style={[st.pinnedText, own && { color: colors.brand100 }]}>Pinned</Text>
            </View>
          ) : null}
          {m.forwarded_from_id && !deleted ? (
            <View style={st.pinned}>
              <Forward size={11} color={own ? colors.brand100 : colors.ink500} />
              <Text style={[st.pinnedText, { color: own ? colors.brand100 : colors.ink500, fontStyle: "italic" }]}>Forwarded</Text>
            </View>
          ) : null}
          {m.reply_to_id && !deleted ? (
            <View style={[st.quote, own && { backgroundColor: "rgba(255,255,255,0.18)", borderLeftColor: colors.white }]}>
              <Text style={[st.quoteName, own && { color: colors.white }]}>{parentName ?? "Reply"}</Text>
              <Text style={[st.quoteText, own && { color: colors.brand100 }]} numberOfLines={2}>
                {parent ? (parent.deleted_at ? "Message deleted" : parent.body || "Attachment") : "Original message"}
              </Text>
            </View>
          ) : null}
          {deleted ? (
            <Text style={[st.body, { fontStyle: "italic", color: own ? colors.brand100 : colors.ink400 }]}>
              {m.deleted_by && m.deleted_by !== m.sender_id ? "Removed by an administrator" : "This message was deleted"}
            </Text>
          ) : (
            <>
              {m.sticker ? <StickerView id={m.sticker} /> : null}
              {m.body ? <Text style={[st.body, own && { color: colors.white }]} selectable>{m.body}</Text> : null}
              <AttachmentList items={attachments} own={own} />
            </>
          )}
        </Pressable>
        {m.failed ? (
          <View style={st.failed}>
            <AlertCircle size={14} color={colors.danger600} />
            <Text style={st.failedText}>Not sent.</Text>
            <Pressable onPress={onRetry} hitSlop={8}><Text style={[st.failedText, { fontWeight: "700", textDecorationLine: "underline" }]}>Retry</Text></Pressable>
            <Pressable onPress={onDiscard} hitSlop={8}><Text style={[st.failedText, { color: colors.ink500, textDecorationLine: "underline" }]}>Discard</Text></Pressable>
          </View>
        ) : (
          <Text style={st.meta}>
            {m.pending ? "Sending..." : messageTime(m.created_at)}
            {m.edited_at && !deleted ? " · edited" : ""}
            {receipt ? <Text style={{ color: receipt === "read" ? colors.brand600 : colors.ink400 }}>{receipt === "sent" ? "  ✓" : "  ✓✓"}</Text> : null}
          </Text>
        )}
        {grouped_r.size ? (
          <View style={[st.reactions, own && { justifyContent: "flex-end" }]}>
            {Array.from(grouped_r.entries()).map(([emoji, count]) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`${emoji} ${count}`}
                accessibilityState={{ selected: mine.has(emoji) }}
                onPress={() => onReact(emoji)}
                style={[st.reaction, mine.has(emoji) && st.reactionMine]}
              >
                <Text style={{ fontSize: 13 }}>{emoji}</Text>
                <Text style={st.reactionCount}>{count}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}


const st = StyleSheet.create({
  headerTitle: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 220 },
  headerIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.brand50, alignItems: "center", justifyContent: "center" },
  headerName: { fontSize: 16, fontWeight: "700", color: colors.ink900 },
  headerSub: { fontSize: 12, color: colors.ink500 },
  day: { alignItems: "center", marginVertical: 10 },
  dayText: { fontSize: 12, fontWeight: "600", color: colors.ink600, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 12, overflow: "hidden" },
  system: { alignItems: "center", marginVertical: 6, paddingHorizontal: 24 },
  systemText: { fontSize: 12, color: colors.ink600, backgroundColor: colors.ink100, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: "hidden", textAlign: "center" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12 },
  sender: { fontSize: 12, fontWeight: "600", color: colors.ink600, marginBottom: 3, marginLeft: 4 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  bubbleOwn: { backgroundColor: colors.brand600, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: colors.ink100, borderBottomLeftRadius: 6 },
  body: { fontSize: 16, lineHeight: 22, color: colors.ink900 },
  meta: { fontSize: 11, color: colors.ink400, marginTop: 3, marginHorizontal: 4 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.brand400, backgroundColor: colors.white, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  quoteName: { fontSize: 12, fontWeight: "700", color: colors.ink700 },
  quoteText: { fontSize: 13, color: colors.ink600 },
  pinned: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  pinnedText: { fontSize: 11, fontWeight: "700", color: colors.brand700 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  reaction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  reactionMine: { borderColor: colors.brand300, backgroundColor: colors.brand50 },
  reactionCount: { fontSize: 12, fontWeight: "600", color: colors.ink700 },
  failed: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  failedText: { fontSize: 12, color: colors.danger600 },
  typing: { fontSize: 12, color: colors.ink500, fontStyle: "italic", paddingHorizontal: 16, paddingBottom: 4 },
  composer: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white, paddingTop: 8, paddingHorizontal: 8, gap: 6 },
  replyBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.brand50, borderLeftWidth: 3, borderLeftColor: colors.brand500, borderRadius: 10, paddingLeft: 10 },
  replyTitle: { fontSize: 12, fontWeight: "700", color: colors.brand800 },
  replyText: { fontSize: 13, color: colors.ink600 },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 4 },
  fileChip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 200, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  fileChipText: { fontSize: 13, color: colors.ink800, flexShrink: 1 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "flex-end", minHeight: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.canvas, paddingLeft: 14, paddingRight: 4 },
  input: { flex: 1, maxHeight: 120, fontSize: 16, color: colors.ink900, paddingTop: Platform.OS === "ios" ? 11 : 8, paddingBottom: Platform.OS === "ios" ? 11 : 8 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand600, alignItems: "center", justifyContent: "center" },
  readOnly: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, alignItems: "center" },
  readOnlyText: { fontSize: 13, color: colors.ink500 },
  quickRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 4 },
  quick: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 23, backgroundColor: colors.canvas },
  stickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", paddingVertical: 8 },
});
