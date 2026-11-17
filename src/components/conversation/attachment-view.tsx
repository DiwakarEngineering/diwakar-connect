"use client";

import { useState } from "react";
import { Download, ExternalLink, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, File as FileIcon } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSignedUrl } from "@/lib/storage";
import { fileSize } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { useToast } from "@/components/ui/toast";
import type { Attachment } from "./types";

// Attachment links are valid for 5 minutes.
const TTL = 300;

export function iconFor(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return FileSpreadsheet;
  if (mime.includes("zip")) return FileArchive;
  if (mime.includes("pdf") || mime.includes("word") || mime.startsWith("text/")) return FileText;
  return FileIcon;
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const url = useSignedUrl("attachments", attachment.object_path, TTL);
  const [failed, setFailed] = useState(false);
  if (failed) return <FileAttachment attachment={attachment} />;
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl border border-line bg-canvas"
      aria-label={`Open image ${attachment.file_name}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- private signed URL
        <img
          src={url}
          alt={attachment.file_name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-72 w-auto max-w-full object-contain"
        />
      ) : (
        <div className="h-40 w-56 animate-pulse bg-ink-100" />
      )}
    </a>
  );
}

/** Voice messages and other audio: inline player. */
function AudioAttachment({ attachment }: { attachment: Attachment }) {
  const url = useSignedUrl("attachments", attachment.object_path, TTL);
  const voice = attachment.file_name.startsWith("Voice message");
  return (
    <div className="flex w-full max-w-sm flex-col gap-1 rounded-xl border border-line bg-white px-3 py-2">
      <span className="truncate text-xs font-medium text-ink-600">{voice ? "Voice message" : attachment.file_name}</span>
      {url ? (
        <audio controls preload="metadata" src={url} className="h-9 w-full" aria-label={voice ? "Voice message" : attachment.file_name} />
      ) : (
        <div className="h-9 animate-pulse rounded-full bg-ink-100" />
      )}
    </div>
  );
}

/** Opens a short-lived signed link in a new tab (download) or the browser viewer (preview). */
export function useAttachmentActions(attachment: Attachment) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  async function open(mode: "download" | "preview") {
    setBusy(true);
    // Open the tab first (synchronously, so pop-up blockers allow it), then point it at the URL.
    const tab = mode === "preview" ? window.open("about:blank", "_blank") : null;
    const { data, error } = await getSupabaseBrowserClient()
      .storage.from("attachments")
      .createSignedUrl(attachment.object_path, 120, mode === "download" ? { download: attachment.file_name } : undefined);
    setBusy(false);
    if (error || !data) {
      tab?.close();
      push({ tone: "error", title: mode === "download" ? "Couldn't download file" : "Couldn't open preview", description: friendlyError(error) });
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else window.location.assign(data.signedUrl);
  }
  return { busy, open };
}

/** File types every modern browser displays itself. */
export function canPreviewInBrowser(mime: string) {
  return mime === "application/pdf" || mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime === "text/plain";
}

function FileAttachment({ attachment }: { attachment: Attachment }) {
  const { busy, open } = useAttachmentActions(attachment);
  const Icon = iconFor(attachment.mime_type);
  const download = () => open("download");

  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900">{attachment.file_name}</span>
        <span className="block text-xs text-ink-500">{fileSize(attachment.size_bytes)}</span>
      </span>
      {canPreviewInBrowser(attachment.mime_type) ? (
        <button
          type="button"
          onClick={() => void open("preview")}
          disabled={busy}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
          aria-label={`Preview ${attachment.file_name}`}
          title="Preview"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
        aria-label={`Download ${attachment.file_name}`}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {attachments.map((a) =>
        a.mime_type.startsWith("image/") && a.mime_type !== "image/heic" ? (
          <ImageAttachment key={a.id} attachment={a} />
        ) : a.mime_type.startsWith("audio/") ? (
          <AudioAttachment key={a.id} attachment={a} />
        ) : (
          <FileAttachment key={a.id} attachment={a} />
        ),
      )}
    </div>
  );
}
