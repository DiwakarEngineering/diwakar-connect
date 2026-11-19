"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { RoomEvent, type Participant, type Room } from "livekit-client";
import { ChevronLeft, ChevronRight, Hand, Maximize, MousePointerClick, X } from "lucide-react";
import { useSignedUrl } from "@/lib/storage";
import { Spinner } from "@/components/ui/spinner";
import { parseData, sendData, type StageShare } from "./stage";

type Pdf = Extract<StageShare, { kind: "pdf" }>;
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
};
type Msg = { t: "ctl-req" } | { t: "ctl-deny" } | { t: "goto"; page: number };
const TOPIC = "pres";

async function loadPdf(url: string): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return (await pdfjs.getDocument({ url }).promise) as unknown as PdfDoc;
}

function PageCanvas({ doc, page, fit, className }: { doc: PdfDoc; page: number; fit: { w: number; h: number }; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { cancel: () => void } | null = null;
    let cancelled = false;
    void doc.getPage(page).then((p) => {
      if (cancelled || !ref.current || fit.w <= 0 || fit.h <= 0) return;
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(fit.w / base.width, fit.h / base.height);
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: scale * dpr });
      const c = ref.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / dpr)}px`;
      c.style.height = `${Math.floor(vp.height / dpr)}px`;
      const t = p.render({ canvas: c, viewport: vp });
      task = t;
      t.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, fit.h, fit.w, page]);
  return <canvas ref={ref} className={className} />;
}

/**
 * A shared PDF presentation (PowerPoint is converted to PDF first). The current
 * slide lives in the presenter's attributes, so everyone - including late
 * joiners - sees the same slide. Others may ask for control; the presenter
 * must approve and can take it back at any time.
 */
export function Presentation({
  room,
  me,
  presenter,
  share,
  nameOf,
  onStop,
}: {
  room: Room;
  me: string;
  presenter: string;
  share: Pdf;
  nameOf: (identity: string) => string;
  /** Presenter or organizer: stop presenting. */
  onStop?: () => void;
}) {
  const isPresenter = me === presenter;
  const hasControl = isPresenter ? !share.controller || share.controller === me : share.controller === me;
  const url = useSignedUrl("attachments", share.path, 3600);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<string[]>([]);
  const [asked, setAsked] = useState(false);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef(share);
  useEffect(() => {
    shareRef.current = share;
  }, [share]);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: PdfDoc | null = null;
    loadPdf(url)
      .then((d) => {
        loaded = d;
        if (alive) setDoc(d);
        else void d.destroy();
      })
      .catch(() => alive && setError("This presentation couldn't be opened. You may not have access to the file."));
    return () => {
      alive = false;
      void loaded?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit({ w: el.clientWidth - 16, h: el.clientHeight - 16 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Presenter: publish the slide (and controller) for everyone. */
  const publish = useCallback(
    async (patch: Partial<Pdf>) => {
      const next = { ...shareRef.current, ...patch };
      await room.localParticipant.setAttributes({ share: JSON.stringify(next) });
    },
    [room],
  );

  const goTo = useCallback(
    (page: number) => {
      const pages = doc?.numPages ?? share.pages;
      const target = Math.min(Math.max(1, page), Math.max(1, pages));
      if (isPresenter) void publish({ page: target, pages });
      else if (hasControl) void sendData(room.localParticipant, TOPIC, { t: "goto", page: target } satisfies Msg, [presenter]);
    },
    [doc, hasControl, isPresenter, presenter, publish, room, share.pages],
  );

  // The presenter records the real page count once the file has loaded.
  useEffect(() => {
    if (isPresenter && doc && doc.numPages !== share.pages) void publish({ pages: doc.numPages });
  }, [doc, isPresenter, publish, share.pages]);

  // Control requests and remote slide changes.
  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: Participant, _k?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      const msg = parseData<Msg>(payload);
      if (!msg) return;
      if (isPresenter && msg.t === "ctl-req") setRequests((r) => (r.includes(participant.identity) ? r : [...r, participant.identity]));
      // Only the approved controller may move slides; anything else is ignored.
      if (isPresenter && msg.t === "goto" && shareRef.current.controller === participant.identity) {
        void publish({ page: Math.min(Math.max(1, msg.page), shareRef.current.pages || 1) });
      }
      if (!isPresenter && msg.t === "ctl-deny" && participant.identity === presenter) setAsked(false);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [isPresenter, presenter, publish, room]);

  useEffect(() => {
    if (share.controller === me) setAsked(false);
  }, [me, share.controller]);

  // Arrow keys for whoever has control.
  useEffect(() => {
    if (!hasControl) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") goTo(shareRef.current.page + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") goTo(shareRef.current.page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, hasControl]);

  const pages = doc?.numPages ?? share.pages;

  return (
    <div ref={rootRef} className="flex h-full flex-col overflow-hidden rounded-2xl bg-ink-900" aria-label={`Presentation: ${share.name}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{share.name}</span>
        {share.controller && share.controller !== presenter ? (
          <span className="rounded-md bg-brand-500/20 px-2 py-0.5 text-xs text-brand-200">
            {share.controller === me ? "You have control" : `${nameOf(share.controller)} has control`}
          </span>
        ) : null}
        {isPresenter && share.controller ? (
          <button type="button" onClick={() => void publish({ controller: null })} className="rounded-md border border-ink-600 px-2 py-0.5 text-xs hover:bg-ink-800">
            Take back control
          </button>
        ) : null}
        {!isPresenter && !hasControl ? (
          <button
            type="button"
            disabled={asked}
            onClick={() => {
              setAsked(true);
              void sendData(room.localParticipant, TOPIC, { t: "ctl-req" } satisfies Msg, [presenter]);
            }}
            className="flex items-center gap-1 rounded-md border border-ink-600 px-2 py-0.5 text-xs hover:bg-ink-800 disabled:opacity-60"
          >
            <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
            {asked ? "Control requested" : "Request control"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen())}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-200 hover:bg-ink-800"
          aria-label="Full-screen presentation"
          title="Full screen"
        >
          <Maximize className="h-4 w-4" aria-hidden="true" />
        </button>
        {onStop ? (
          <button type="button" onClick={onStop} className="flex items-center gap-1 rounded-lg bg-danger-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-danger-700">
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Stop presenting
          </button>
        ) : null}
      </div>

      {isPresenter && requests.length ? (
        <div className="flex flex-wrap items-center gap-2 bg-brand-600/20 px-3 py-2 text-sm" role="alert">
          <Hand className="h-4 w-4 text-brand-300" aria-hidden="true" />
          <span className="flex-1">{nameOf(requests[0]!)} is asking to control the slides.</span>
          <button
            type="button"
            onClick={() => {
              const who = requests[0]!;
              setRequests((r) => r.slice(1));
              void publish({ controller: who });
            }}
            className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white"
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => {
              const who = requests[0]!;
              setRequests((r) => r.slice(1));
              void sendData(room.localParticipant, TOPIC, { t: "ctl-deny" } satisfies Msg, [who]);
            }}
            className="rounded-md border border-ink-600 px-2.5 py-1 text-xs"
          >
            Deny
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {isPresenter && doc ? (
          <ol className="scrollbar-thin hidden w-36 shrink-0 space-y-2 overflow-y-auto border-r border-white/10 p-2 lg:block" aria-label="Slides">
            {Array.from({ length: Math.min(pages, 60) }, (_, i) => i + 1).map((n) => (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => goTo(n)}
                  aria-current={share.page === n ? "true" : undefined}
                  className={clsx("block w-full overflow-hidden rounded-md bg-white ring-2", share.page === n ? "ring-brand-500" : "ring-transparent hover:ring-ink-500")}
                  aria-label={`Slide ${n}`}
                >
                  <PageCanvas doc={doc} page={n} fit={{ w: 120, h: 90 }} className="mx-auto" />
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center p-2">
          {error ? (
            <p className="max-w-sm text-center text-sm text-ink-300">{error}</p>
          ) : doc ? (
            <PageCanvas doc={doc} page={share.page} fit={fit} className="rounded-md bg-white shadow-pop" />
          ) : (
            <Spinner className="h-6 w-6 text-ink-300" label="Loading presentation" />
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-white/10 py-2">
        <button type="button" onClick={() => goTo(share.page - 1)} disabled={!hasControl || share.page <= 1} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-200 hover:bg-ink-800 disabled:opacity-30" aria-label="Previous slide">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="min-w-24 text-center text-sm tabular-nums text-ink-200" aria-live="polite">
          Slide {share.page} of {pages || "?"}
        </span>
        <button type="button" onClick={() => goTo(share.page + 1)} disabled={!hasControl || (pages > 0 && share.page >= pages)} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-200 hover:bg-ink-800 disabled:opacity-30" aria-label="Next slide">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
