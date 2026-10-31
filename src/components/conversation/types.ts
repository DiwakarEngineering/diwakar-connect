import type { Enums, Tables } from "@/lib/database.types";

export type Message = Omit<Tables<"messages">, "search"> & {
  /** Optimistic message not yet confirmed by the server. */
  pending?: boolean;
  /** Send failed; offered for retry or discard. */
  failed?: boolean;
};

export type Reaction = Tables<"message_reactions">;
export type Attachment = Tables<"attachments">;

export const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, kind, body, reply_to_id, mentions, created_at, edited_at, deleted_at, deleted_by";

export type ConversationMeta = {
  id: string;
  kind: Enums<"conversation_kind">;
  title: string;
  /** Direct chats: the other person (or yourself, for a note-to-self chat). */
  otherUserId: string | null;
  memberIds: string[];
  canPost: boolean;
  /** Group owner, or team owner/admin for a channel. */
  canManage: boolean;
  isPinned: boolean;
  isMuted: boolean;
  /** Messages up to this time are hidden for me ("Clear chat history"). */
  clearedAt: string | null;
  channel: Tables<"channels"> | null;
  team: Pick<Tables<"teams">, "id" | "name" | "archived_at"> | null;
  groupTitle: string | null;
};

export type SendInput = {
  body: string;
  mentions: string[];
  replyToId: string | null;
  files: File[];
};
