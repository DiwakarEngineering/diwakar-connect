"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { FileText, Monitor, PanelRight, PictureInPicture2, Presentation, Square, Upload, X, PenLine } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fileSize, listTime } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import type { PresenterMode } from "./stage";

type Attachment = Tables<"attachments">;
const PRESENTABLE = /\.(pdf|pptx?|odp|docx?)$/i;
export const isPdf = (a: Pick<Attachment, "mime_type" | "file_name">) => a.mime_type === "application/pdf" || /\.pdf$/i.test(a.file_name);

const MODES: { id: PresenterMode; label: string; hint: string; icon: typeof Square }[] = [
  { id: "content", label: "Content only", hint: "Your screen fills the stage", icon: Square },
  { id: "side", label: "Side by side", hint: "You beside your content", icon: PanelRight },
  { id: "pip", label: "Picture in picture", hint: "You in a corner of your content", icon: PictureInPicture2 },
];

/**
 * "Share content" drawer: screen / window / tab (the browser asks which), with
 * computer sound where supported and a presenter mode; a presentation or
 * document from this conversation's files (or upload one); or a whiteboard.
 */
export function ShareDrawer({
  conversationId,
  audioSupported,
  busy,
  blockedReason,
  onScreen,
  onWhiteboard,
  onPresent,
  onUpload,
  onClose,
}: {
  conversationId: string;
  audioSupported: boolean;
  busy: boolean;
  /** Someone else is presenting and you can't take over. */
  blockedReason: string | null;
  onScreen: (opts: { audio: boolean; mode: PresenterMode }) => void;
  onWhiteboard: () => void;
  onPresent: (a: Attachment) => void;
  onUpload: (file: File) => void;
  onClose: () => void;
}) {
  const [audio, setAudio] = useState(false);
  const [mode, setMode] = useState<PresenterMode>("content");
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSupabaseBrowserClient()
      .from("attachments")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setFiles((data ?? []).filter((a) => PRESENTABLE.test(a.file_name)).slice(0, 20)));
  }, [conversationId]);

  const disabled = busy || !!blockedReason;

  return (
    <aside aria-label="Share content" className="fixed inset-0 z-40 flex flex-col bg-ink-900 text-white md:static md:w-[360px] md:rounded-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="text-base font-semibold">Share content</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-300 hover:bg-ink-800" aria-label="Close share content">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {blockedReason ? <p className="rounded-xl bg-brand-600/15 p-3 text-sm text-brand-100" role="status">{blockedReason}</p> : null}

        <section aria-labelledby="share-screen">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="share-screen" className="text-sm font-semibold">Screen, window or tab</h3>
          </div>
          {audioSupported ? (
            <div className="mb-3 rounded-xl bg-ink-800 px-3 [&_*]:text-white">
              <Switch label="Include computer sound" description="Share audio from a tab or your computer." checked={audio} onChange={setAudio} />
            </div>
          ) : null}
          <p className="mb-2 text-xs text-ink-300">Presenter mode</p>
          <div className="mb-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Presenter mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                title={m.hint}
                className={clsx(
                  "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[11px] font-medium",
                  mode === m.id ? "border-brand-500 bg-brand-500/15 text-brand-200" : "border-ink-700 text-ink-200 hover:bg-ink-800",
                )}
              >
                <m.icon className="h-5 w-5" aria-hidden="true" />
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onScreen({ audio, mode })}
            className="flex w-full items-center gap-3 rounded-xl bg-brand-600 px-4 py-3 text-left text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            <Monitor className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">
              Choose what to share
              <span className="block text-xs font-normal text-brand-100">Your browser asks for permission and lets you pick a screen, window or tab.</span>
            </span>
          </button>
        </section>

        <section aria-labelledby="share-board">
          <h3 id="share-board" className="mb-2 text-sm font-semibold">Whiteboard</h3>
          <button type="button" disabled={disabled} onClick={onWhiteboard} className="flex w-full items-center gap-3 rounded-xl border border-ink-700 px-4 py-3 text-left text-sm hover:bg-ink-800 disabled:opacity-50">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <PenLine className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold">Diwakar whiteboard</span>
              <span className="block text-xs text-ink-300">Draw and write together in real time</span>
            </span>
          </button>
        </section>

        <section aria-labelledby="share-files">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="share-files" className="text-sm font-semibold">Presentations and documents</h3>
            <button type="button" disabled={disabled} onClick={() => fileRef.current?.click()} aria-label="Browse for a presentation to upload" className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-300 hover:bg-ink-800 disabled:opacity-50">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Browse
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.ppt,.pptx,.odp,.doc,.docx,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onUpload(f);
              }}
            />
          </div>
          {files === null ? (
            <p className="text-xs text-ink-400">Loading recent files...</p>
          ) : files.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-700 p-3 text-xs text-ink-300">No presentations shared in this chat yet. Use Browse to upload a PDF or PowerPoint; it&apos;s saved to the chat for everyone in it.</p>
          ) : (
            <ul className="space-y-1" aria-label="Recently shared files">
              {files.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onPresent(a)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-ink-800 disabled:opacity-50"
                  >
                    <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", isPdf(a) ? "bg-danger-600/20 text-danger-50" : "bg-brand-500/20 text-brand-300")}>
                      {isPdf(a) ? <FileText className="h-4 w-4" aria-hidden="true" /> : <Presentation className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{a.file_name}</span>
                      <span className="block text-[11px] text-ink-400">
                        {fileSize(a.size_bytes)} · {listTime(a.created_at)}
                        {isPdf(a) ? "" : " · converts to PDF"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
