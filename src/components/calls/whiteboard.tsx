"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { RoomEvent, type Participant, type Room } from "livekit-client";
import {
  ArrowUpRight,
  Circle,
  Download,
  Eraser,
  Highlighter,
  Minus,
  MessageSquareShare,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { jpegToPdf } from "@/lib/pdf-export";
import { newId } from "@/lib/uuid";
import { parseData, sendData } from "./stage";

type Tool = "pen" | "highlighter" | "line" | "arrow" | "rect" | "ellipse" | "text" | "eraser";
type Pt = [number, number];
/** Coordinates are 0..1 of the board (16:9), widths are a fraction of the board width. */
export type Stroke = {
  id: string;
  by: string;
  tool: Exclude<Tool, "eraser">;
  color: string;
  width: number;
  points: Pt[];
  text?: string;
};
type Op = { t: "add"; s: Stroke } | { t: "del"; ids: string[] } | { t: "clear" } | { t: "draft"; s: Stroke | null } | { t: "sync?" };
type HistoryEntry = { kind: "add"; strokes: Stroke[] } | { kind: "del"; strokes: Stroke[] };

const COLORS = ["#1B2440", "#F06A1A", "#C42B2B", "#15803D", "#2B4C9B", "#8A5A00"];
const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "highlighter", label: "Highlighter", icon: Highlighter },
  { id: "text", label: "Text", icon: Type },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "eraser", label: "Eraser", icon: Eraser },
];
const TOPIC = "wb";
const SYNC_TOPIC = "wb-sync";

function draw(ctx: CanvasRenderingContext2D, s: Stroke, W: number, H: number) {
  const px = (p: Pt): [number, number] => [p[0] * W, p[1] * H];
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = Math.max(1, s.width * W);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "highlighter") ctx.globalAlpha = 0.35;
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  if (!a || !b) return ctx.restore();
  ctx.beginPath();
  if (s.tool === "pen" || s.tool === "highlighter") {
    const [x0, y0] = px(a);
    ctx.moveTo(x0, y0);
    for (const p of s.points.slice(1)) ctx.lineTo(...px(p));
    if (s.points.length === 1) ctx.lineTo(x0 + 0.1, y0 + 0.1);
    ctx.stroke();
  } else if (s.tool === "line" || s.tool === "arrow") {
    const [x0, y0] = px(a);
    const [x1, y1] = px(b);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (s.tool === "arrow") {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = Math.max(10, ctx.lineWidth * 4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - len * Math.cos(ang - 0.45), y1 - len * Math.sin(ang - 0.45));
      ctx.lineTo(x1 - len * Math.cos(ang + 0.45), y1 - len * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
    }
  } else if (s.tool === "rect") {
    const [x0, y0] = px(a);
    const [x1, y1] = px(b);
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else if (s.tool === "ellipse") {
    const [x0, y0] = px(a);
    const [x1, y1] = px(b);
    ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool === "text" && s.text) {
    const [x0, y0] = px(a);
    ctx.font = `600 ${Math.max(12, s.width * W * 6)}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    s.text.split("\n").forEach((line, i) => ctx.fillText(line, x0, y0 + i * Math.max(14, s.width * W * 7.2)));
  }
  ctx.restore();
}

/** Distance from point p to the stroke (for the eraser), in board units. */
function hits(s: Stroke, p: Pt, r: number) {
  const near = (q: Pt) => Math.hypot(q[0] - p[0], (q[1] - p[1]) * (9 / 16)) < r + s.width;
  if (s.tool === "pen" || s.tool === "highlighter" || s.tool === "text") return s.points.some(near);
  const [a, b] = [s.points[0]!, s.points[s.points.length - 1]!];
  const minX = Math.min(a[0], b[0]) - r, maxX = Math.max(a[0], b[0]) + r, minY = Math.min(a[1], b[1]) - r, maxY = Math.max(a[1], b[1]) + r;
  return p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
}

/**
 * Collaborative whiteboard shared in the meeting. Everyone in the call can draw
 * at the same time (LiveKit data channel). People joining later get the board
 * from its owner. Clearing is limited to the board owner and the organizer.
 */
export function Whiteboard({
  room,
  me,
  owner,
  organizer,
  canClear,
  nameOf,
  onClose,
  onSaveToChat,
}: {
  room: Room;
  me: string;
  owner: string;
  /** The call organizer may also clear the board. */
  organizer: string | null;
  canClear: boolean;
  nameOf: (identity: string) => string;
  onClose?: () => void;
  onSaveToChat?: (png: Blob) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const draftsRef = useRef(new Map<string, Stroke>());
  const current = useRef<Stroke | null>(null);
  const lastDraftSent = useRef(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[1]!);
  const [size, setSize] = useState(0.004);
  const [undo, setUndo] = useState<HistoryEntry[]>([]);
  const [redo, setRedo] = useState<HistoryEntry[]>([]);
  const [textAt, setTextAt] = useState<{ p: Pt; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [, setTick] = useState(0);
  const isOwner = me === owner;
  const synced = useRef(false);

  const render = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, c.width, c.height);
    for (const s of strokesRef.current) draw(ctx, s, c.width, c.height);
    for (const s of draftsRef.current.values()) draw(ctx, s, c.width, c.height);
    if (current.current) draw(ctx, current.current, c.width, c.height);
  }, []);

  // Keep the canvas at device resolution, 16:9.
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return;
    const resize = () => {
      const w = wrap.clientWidth;
      const h = Math.min(wrap.clientHeight, (w * 9) / 16);
      const width = Math.min(w, (h * 16) / 9);
      const dpr = window.devicePixelRatio || 1;
      c.style.width = `${width}px`;
      c.style.height = `${(width * 9) / 16}px`;
      c.width = Math.round(width * dpr);
      c.height = Math.round(((width * 9) / 16) * dpr);
      render();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [render]);

  const broadcast = useCallback((op: Op, to?: string[]) => void sendData(room.localParticipant, TOPIC, op, to).catch(() => undefined), [room]);

  const apply = useCallback(
    (op: Op, from: string) => {
      if (op.t === "add") {
        if (!strokesRef.current.some((s) => s.id === op.s.id)) strokesRef.current = [...strokesRef.current, op.s];
        draftsRef.current.delete(from);
      } else if (op.t === "del") {
        const ids = new Set(op.ids);
        strokesRef.current = strokesRef.current.filter((s) => !ids.has(s.id));
      } else if (op.t === "clear") {
        strokesRef.current = [];
        draftsRef.current.clear();
        setUndo([]);
        setRedo([]);
      } else if (op.t === "draft") {
        if (op.s) draftsRef.current.set(from, op.s);
        else draftsRef.current.delete(from);
      }
      render();
      setTick((t) => t + 1);
    },
    [render],
  );

  // Live updates from others; the owner answers sync requests with the full board.
  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: Participant, _k?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      const op = parseData<Op>(payload);
      if (!op) return;
      if (op.t === "sync?") {
        if (isOwner) void room.localParticipant.sendText(JSON.stringify(strokesRef.current), { topic: SYNC_TOPIC, destinationIdentities: [participant.identity] });
        return;
      }
      // Only the board owner or the organizer can clear it for everyone.
      if (op.t === "clear" && participant.identity !== owner && participant.identity !== organizer) return;
      apply(op, participant.identity);
    };
    room.on(RoomEvent.DataReceived, onData);
    room.registerTextStreamHandler(SYNC_TOPIC, async (reader) => {
      try {
        const all = JSON.parse(await reader.readAll()) as Stroke[];
        const known = new Set(strokesRef.current.map((s) => s.id));
        strokesRef.current = [...all.filter((s) => !known.has(s.id)), ...strokesRef.current];
        synced.current = true;
        render();
      } catch {
        /* ignore */
      }
    });
    // Joining an existing board: ask its owner for everything drawn so far (retry until it arrives).
    let tries = 0;
    const ask = () => {
      if (isOwner || synced.current || tries++ >= 5) return;
      broadcast({ t: "sync?" }, [owner]);
    };
    ask();
    const retry = window.setInterval(ask, 1500);
    return () => {
      window.clearInterval(retry);
      room.off(RoomEvent.DataReceived, onData);
      room.unregisterTextStreamHandler(SYNC_TOPIC);
    };
  }, [apply, broadcast, isOwner, organizer, owner, render, room]);

  const pos = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  function commit(strokes: Stroke[]) {
    for (const s of strokes) {
      apply({ t: "add", s }, me);
      broadcast({ t: "add", s });
    }
    setUndo((u) => [...u.slice(-99), { kind: "add", strokes }]);
    setRedo([]);
  }

  function erase(p: Pt) {
    const gone = strokesRef.current.filter((s) => hits(s, p, 0.012));
    if (!gone.length) return;
    apply({ t: "del", ids: gone.map((s) => s.id) }, me);
    broadcast({ t: "del", ids: gone.map((s) => s.id) });
    setUndo((u) => [...u.slice(-99), { kind: "del", strokes: gone }]);
    setRedo([]);
  }

  function onDown(e: React.PointerEvent) {
    if (textAt) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === "eraser") return erase(p);
    if (tool === "text") return setTextAt({ p, value: "" });
    current.current = { id: newId(), by: me, tool, color, width: tool === "highlighter" ? size * 4 : size, points: [p] };
    render();
  }

  function onMove(e: React.PointerEvent) {
    if (tool === "eraser" && e.buttons === 1) return erase(pos(e));
    const s = current.current;
    if (!s) return;
    const p = pos(e);
    s.points = s.tool === "pen" || s.tool === "highlighter" ? [...s.points, p] : [s.points[0]!, p];
    render();
    if (Date.now() - lastDraftSent.current > 80) {
      lastDraftSent.current = Date.now();
      broadcast({ t: "draft", s });
    }
  }

  function onUp() {
    const s = current.current;
    current.current = null;
    if (!s) return;
    if (s.tool !== "pen" && s.tool !== "highlighter" && s.points.length < 2) return render();
    commit([s]);
  }

  function addText() {
    if (!textAt) return;
    const value = textAt.value.trim();
    setTextAt(null);
    if (!value) return;
    commit([{ id: newId(), by: me, tool: "text", color, width: size, points: [textAt.p], text: value.slice(0, 500) }]);
  }

  function doUndo() {
    const entry = undo[undo.length - 1];
    if (!entry) return;
    setUndo((u) => u.slice(0, -1));
    setRedo((r) => [...r, entry]);
    if (entry.kind === "add") {
      const ids = entry.strokes.map((s) => s.id);
      apply({ t: "del", ids }, me);
      broadcast({ t: "del", ids });
    } else {
      for (const s of entry.strokes) {
        apply({ t: "add", s }, me);
        broadcast({ t: "add", s });
      }
    }
  }

  function doRedo() {
    const entry = redo[redo.length - 1];
    if (!entry) return;
    setRedo((r) => r.slice(0, -1));
    setUndo((u) => [...u, entry]);
    if (entry.kind === "add") {
      for (const s of entry.strokes) {
        apply({ t: "add", s }, me);
        broadcast({ t: "add", s });
      }
    } else {
      const ids = entry.strokes.map((s) => s.id);
      apply({ t: "del", ids }, me);
      broadcast({ t: "del", ids });
    }
  }

  function clearBoard() {
    if (!canClear || !window.confirm("Clear the whiteboard for everyone?")) return;
    apply({ t: "clear" }, me);
    broadcast({ t: "clear" });
  }

  const blob = (type: "image/png" | "image/jpeg") =>
    new Promise<Blob | null>((resolve) => {
      const c = canvasRef.current;
      if (!c) return resolve(null);
      c.toBlob(resolve, type, 0.92);
    });

  async function exportAs(kind: "png" | "pdf") {
    const c = canvasRef.current;
    if (!c) return;
    const file = kind === "png" ? await blob("image/png") : await blob("image/jpeg").then((j) => (j ? jpegToPdf(j, c.width, c.height) : null));
    if (!file) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = `Whiteboard ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".")}.${kind}`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function saveToChat() {
    if (!onSaveToChat) return;
    const png = await blob("image/png");
    if (!png) return;
    setSaving(true);
    await onSaveToChat(png).finally(() => setSaving(false));
  }

  const btn = (on?: boolean) =>
    clsx("flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:opacity-40", on ? "bg-brand-500 text-white" : "text-ink-200 hover:bg-ink-700");

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-ink-900" aria-label="Whiteboard">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1.5" role="toolbar" aria-label="Whiteboard tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTool(t.id)} className={btn(tool === t.id)} aria-pressed={tool === t.id} aria-label={t.label} title={t.label}>
            <t.icon className="h-4 w-4" aria-hidden="true" />
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            className={clsx("h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-ink-900", color === c ? "ring-white" : "ring-transparent")}
            style={{ backgroundColor: c }}
          />
        ))}
        <label className="ml-1 flex items-center gap-1 text-xs text-ink-300">
          <span className="sr-only">Thickness</span>
          <input type="range" min={0.002} max={0.012} step={0.001} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-20 accent-brand-500" />
        </label>
        <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />
        <button type="button" onClick={doUndo} disabled={!undo.length} className={btn()} aria-label="Undo" title="Undo">
          <Undo2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={doRedo} disabled={!redo.length} className={btn()} aria-label="Redo" title="Redo">
          <Redo2 className="h-4 w-4" aria-hidden="true" />
        </button>
        {canClear ? (
          <button type="button" onClick={clearBoard} className={btn()} aria-label="Clear board" title="Clear board for everyone">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => void exportAs("png")} className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-200 hover:bg-ink-700">
            <Download className="h-4 w-4" aria-hidden="true" /> PNG
          </button>
          <button type="button" onClick={() => void exportAs("pdf")} className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-200 hover:bg-ink-700">
            <Download className="h-4 w-4" aria-hidden="true" /> PDF
          </button>
          {onSaveToChat ? (
            <button type="button" onClick={() => void saveToChat()} disabled={saving} className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-200 hover:bg-ink-700 disabled:opacity-50">
              <MessageSquareShare className="h-4 w-4" aria-hidden="true" /> {saving ? "Saving..." : "Save to chat"}
            </button>
          ) : null}
          {onClose ? (
            <button type="button" onClick={onClose} className="flex h-9 items-center gap-1 rounded-lg bg-danger-600 px-2.5 text-xs font-semibold text-white hover:bg-danger-700">
              <X className="h-4 w-4" aria-hidden="true" /> Stop
            </button>
          ) : null}
        </div>
      </div>
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center p-2">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Whiteboard shared by ${nameOf(owner)}`}
          className={clsx("touch-none rounded-lg shadow-pop", tool === "text" ? "cursor-text" : tool === "eraser" ? "cursor-cell" : "cursor-crosshair")}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {textAt ? (
          <div className="absolute inset-x-4 bottom-4 mx-auto flex max-w-md gap-2 rounded-xl bg-ink-800 p-2 shadow-pop">
            <input
              autoFocus
              value={textAt.value}
              maxLength={500}
              onChange={(e) => setTextAt({ ...textAt, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") addText();
                if (e.key === "Escape") setTextAt(null);
              }}
              placeholder="Type text, then press Enter"
              aria-label="Whiteboard text"
              className="h-9 min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 text-sm text-white"
            />
            <button type="button" onClick={addText} className="rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white">
              Add
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
