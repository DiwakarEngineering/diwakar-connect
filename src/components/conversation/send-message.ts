"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { safeFileName } from "@/lib/storage";
import { newId } from "@/lib/uuid";
import type { SendInput } from "./types";

/**
 * Send one message (with files) to a conversation without the optimistic
 * timeline - used where no conversation is open yet (new chat). Same storage
 * layout and order as useMessages().send: upload, insert message, attach.
 */
export async function sendMessageTo(conversationId: string, me: string, input: SendInput): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const uploaded: { path: string; file: File }[] = [];
  const id = newId();
  try {
    for (const file of input.files) {
      const path = `${conversationId}/${me}/${newId()}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`"${file.name}" couldn't be uploaded. ${friendlyError(error, "")}`.trim());
      uploaded.push({ path, file });
    }
    const { error: insertError } = await supabase.from("messages").insert({
      id,
      conversation_id: conversationId,
      sender_id: me,
      body: input.body,
      reply_to_id: null,
      mentions: input.mentions,
      sticker: input.sticker ?? null,
    });
    if (insertError) throw new Error(friendlyError(insertError, "Message not sent."));
    if (uploaded.length) {
      const { error: attachError } = await supabase.from("attachments").insert(
        uploaded.map(({ path, file }) => ({
          message_id: id,
          conversation_id: conversationId,
          uploader_id: me,
          object_path: path,
          file_name: file.name.slice(0, 255),
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
        })),
      );
      if (attachError) throw new Error(friendlyError(attachError, "Files couldn't be attached."));
    }
    return id;
  } catch (e) {
    if (uploaded.length) void supabase.storage.from("attachments").remove(uploaded.map((u) => u.path));
    throw e;
  }
}
