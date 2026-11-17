"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Download, ExternalLink, FolderOpen, Search } from "lucide-react";
import type { Person } from "@/components/providers/people-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { fileSize, listTime } from "@/lib/format";
import { useSignedUrl } from "@/lib/storage";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { SidePanel } from "./side-panel";
import { canPreviewInBrowser, iconFor, useAttachmentActions } from "./attachment-view";
import type { Attachment } from "./types";

type Filter = "all" | "images" | "documents" | "audio";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "documents", label: "Documents" },
  { id: "audio", label: "Voice & audio" },
];

function matches(filter: Filter, mime: string) {
  if (filter === "images") return mime.startsWith("image/");
  if (filter === "audio") return mime.startsWith("audio/");
  if (filter === "documents") return !mime.startsWith("image/") && !mime.startsWith("audio/") && !mime.startsWith("video/");
  return true;
}

/** Every file shared in this conversation (RLS: members only), newest first, searchable by name. */
export function FilesPanel({
  conversationId,
  clearedAt,
  people,
  onJump,
  onClose,
}: {
  conversationId: string;
  clearedAt: string | null;
  people: Map<string, Person>;
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    let q = getSupabaseBrowserClient()
      .from("attachments")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (clearedAt) q = q.gt("created_at", clearedAt);
    const { data, error: e } = await q;
    if (e) return setError(friendlyError(e, "Couldn't load shared files."));
    setError(null);
    setFiles(data ?? []);
  }, [clearedAt, conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (files ?? []).filter((f) => matches(filter, f.mime_type) && (!term || f.file_name.toLowerCase().includes(term)));
  }, [files, filter, query]);

  return (
    <SidePanel title="Shared files" onClose={onClose}>
      <div className="space-y-2 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files by name"
            aria-label="Search files by name"
            className="h-9 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm placeholder:text-ink-400 focus:bg-white"
          />
        </div>
        <div role="tablist" aria-label="File type" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.id ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : files === null ? (
          <SkeletonRows rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-5 w-5" aria-hidden="true" />}
            title={files.length === 0 ? "No files shared yet" : "No files match"}
            description={files.length === 0 ? "Files and images sent in this conversation appear here." : undefined}
          />
        ) : (
          <ul aria-label="Shared files" className="divide-y divide-line">
            {visible.map((f) => (
              <FileRow key={f.id} file={f} uploader={f.uploader_id ? people.get(f.uploader_id) : undefined} onJump={onJump} />
            ))}
          </ul>
        )}
      </div>
    </SidePanel>
  );
}

function FileRow({ file, uploader, onJump }: { file: Attachment; uploader: Person | undefined; onJump: (id: string) => void }) {
  const { busy, open } = useAttachmentActions(file);
  const isImage = file.mime_type.startsWith("image/") && file.mime_type !== "image/heic";
  const thumb = useSignedUrl("attachments", isImage ? file.object_path : null, 300);
  const Icon = iconFor(file.mime_type);
  const btn = "flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      {isImage && thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- private signed URL
        <img src={thumb} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <button type="button" onClick={() => onJump(file.message_id)} className="min-w-0 flex-1 text-left" title="Show in conversation">
        <span className="block truncate text-sm font-medium text-ink-900">{file.file_name}</span>
        <span className="block truncate text-xs text-ink-500">
          {[uploader?.display_name ?? "Former employee", fileSize(file.size_bytes), listTime(file.created_at)].join(" · ")}
        </span>
      </button>
      {canPreviewInBrowser(file.mime_type) ? (
        <button type="button" onClick={() => void open("preview")} disabled={busy} className={btn} aria-label={`Preview ${file.file_name}`} title="Preview">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <button type="button" onClick={() => void open("download")} disabled={busy} className={btn} aria-label={`Download ${file.file_name}`} title="Download">
        <Download className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}
