import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, handler, parseJson, requireActiveUser, requireServiceClient } from "@/lib/api";
import { getConversionConfig } from "@/lib/env.server";
import { convertSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const CONVERTIBLE = /\.(pptx?|docx?|xlsx?|odp|odt|ods)$/i;

/**
 * Converts a PowerPoint / Word / Excel attachment to PDF (for presenting and
 * previews) and posts the PDF back into the same conversation, so exactly the
 * same people can open it. Requires a Gotenberg server (GOTENBERG_URL).
 */
export const POST = handler("files.convert", async (request: Request) => {
  const caller = await requireActiveUser(request);
  enforceRateLimit(`convert:${caller.user.id}`, 10, 60_000);
  const { attachmentId } = await parseJson(request, convertSchema);

  const config = getConversionConfig();
  if (!config) {
    throw new ApiError(
      "not_configured",
      "PowerPoint, Word and Excel files need the document conversion service, which isn't set up yet. Save the file as PDF and share that instead.",
    );
  }

  // RLS: the caller must be able to see the attachment (conversation member).
  const { data: att } = await caller.supabase.from("attachments").select("*").eq("id", attachmentId).maybeSingle();
  if (!att) throw new ApiError("not_found", "File not found.");
  if (!CONVERTIBLE.test(att.file_name)) throw new ApiError("invalid_request", "This file type can't be converted.");
  const { data: canPost } = await caller.supabase.rpc("can_post_to_conversation", { p_conversation: att.conversation_id });
  if (!canPost) throw new ApiError("forbidden", "You can't post in this conversation.");

  const admin = requireServiceClient();
  const { data: original, error: dlError } = await admin.storage.from("attachments").download(att.object_path);
  if (dlError || !original) throw new ApiError("not_found", "The original file is no longer available.");

  const form = new FormData();
  form.append("files", original, att.file_name);
  let res: Response;
  try {
    res = await fetch(`${config.url}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
      headers: config.basicAuth ? { Authorization: `Basic ${btoa(config.basicAuth)}` } : undefined,
    });
  } catch {
    throw new ApiError("server_error", "The conversion service can't be reached right now.");
  }
  if (!res.ok) {
    logger.error("files.convert_failed", { status: res.status });
    throw new ApiError("server_error", "The file couldn't be converted.");
  }
  const pdf = await res.arrayBuffer();
  const name = `${att.file_name.replace(/\.[^.]+$/, "").slice(0, 200)}.pdf`;
  const path = `${att.conversation_id}/${caller.user.id}/${randomUUID()}-${name.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-")}`;
  const { error: upError } = await admin.storage.from("attachments").upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (upError) throw new ApiError("server_error", "The converted file couldn't be saved.");

  // Post it as the caller (their own message), so it appears in the chat's shared files.
  const messageId = randomUUID();
  const { error: msgError } = await caller.supabase.from("messages").insert({
    id: messageId,
    conversation_id: att.conversation_id,
    sender_id: caller.user.id,
    body: `PDF version of ${att.file_name}`.slice(0, 8000),
  });
  if (msgError) {
    await admin.storage.from("attachments").remove([path]);
    throw new ApiError("forbidden", "You can't post in this conversation.");
  }
  const { data: created, error: attError } = await admin
    .from("attachments")
    .insert({
      message_id: messageId,
      conversation_id: att.conversation_id,
      uploader_id: caller.user.id,
      object_path: path,
      file_name: name,
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
    })
    .select("*")
    .single();
  if (attError || !created) {
    // Don't leave a half-made message or an unreferenced file behind.
    await admin.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId);
    await admin.storage.from("attachments").remove([path]);
    throw new ApiError("server_error", attError?.message.includes("smaller than") ? attError.message : "The converted file couldn't be attached.");
  }
  return NextResponse.json({ attachment: created });
});
