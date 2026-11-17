"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, SendHorizontal, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";

const MAX_SECONDS = 5 * 60;

/** Pick a recording format the browser supports and storage accepts (codec suffix is dropped on upload). */
function pickMime(): { recorder: string; file: "audio/webm" | "audio/mp4" | "audio/ogg"; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const options = [
    { recorder: "audio/webm;codecs=opus", file: "audio/webm" as const, ext: "webm" },
    { recorder: "audio/webm", file: "audio/webm" as const, ext: "webm" },
    { recorder: "audio/mp4", file: "audio/mp4" as const, ext: "m4a" },
    { recorder: "audio/ogg;codecs=opus", file: "audio/ogg" as const, ext: "ogg" },
  ];
  return options.find((o) => MediaRecorder.isTypeSupported(o.recorder)) ?? null;
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Microphone button that records a voice message. While recording it replaces
 * the composer toolbar with a timer, cancel and send.
 */
export function VoiceRecorder({
  maxAttachmentMb,
  onRecorded,
  onActiveChange,
}: {
  maxAttachmentMb: number;
  onRecorded: (file: File) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const { push } = useToast();
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sendOnStopRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  function cleanup() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
    setState("idle");
    onActiveChange(false);
  }

  // Leaving the conversation while recording discards the recording.
  useEffect(
    () => () => {
      sendOnStopRef.current = false;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [],
  );

  async function start() {
    const mime = pickMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      push({ tone: "error", title: "Voice messages aren't supported in this browser" });
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: mime.recorder, audioBitsPerSecond: 48_000 });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const send = sendOnStopRef.current;
        const blob = new Blob(chunksRef.current, { type: mime.file });
        cleanup();
        if (!send || blob.size === 0) return;
        if (blob.size > maxAttachmentMb * 1024 * 1024) {
          push({ tone: "error", title: "Voice message is too long", description: `Files must be smaller than ${maxAttachmentMb} MB.` });
          return;
        }
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
        onRecorded(new File([blob], `Voice message ${stamp}.${mime.ext}`, { type: mime.file }));
      };
      recorder.start(1000);
      setState("recording");
      onActiveChange(true);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop(true);
      }, 250);
    } catch (e) {
      cleanup();
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      push({
        tone: "error",
        title: denied ? "Microphone access was blocked" : "Couldn't start recording",
        description: denied ? "Allow microphone access for this site in your browser settings, then try again." : undefined,
      });
    }
  }

  function stop(send: boolean) {
    sendOnStopRef.current = send;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else cleanup();
  }

  if (state !== "recording") {
    return (
      <button
        type="button"
        onClick={() => void start()}
        disabled={state === "starting"}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:opacity-50"
        aria-label="Record a voice message"
        title="Record a voice message"
      >
        <Mic className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-2" role="group" aria-label="Recording voice message">
      <button
        type="button"
        onClick={() => stop(false)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-danger-50 hover:text-danger-600"
        aria-label="Cancel recording"
        title="Cancel"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="flex items-center gap-2 text-sm font-medium text-ink-800" aria-live="polite">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger-600" aria-hidden="true" />
        Recording {clock(seconds)}
        <span className="text-xs font-normal text-ink-400">/ {clock(MAX_SECONDS)}</span>
      </span>
      <button
        type="button"
        onClick={() => stop(true)}
        className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"
        aria-label="Send voice message"
      >
        <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Send</span>
      </button>
    </div>
  );
}
