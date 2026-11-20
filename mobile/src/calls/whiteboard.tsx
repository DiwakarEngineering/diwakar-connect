import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Ellipse, Line, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { RoomEvent, type Participant, type Room } from "livekit-client";
import { Pencil, Undo2 } from "lucide-react-native";
import { newId } from "@/lib/storage";
import { colors } from "@/theme";

/** Same data as the website's whiteboard: coordinates 0..1 of a 16:9 board, widths a fraction of its width. */
type Pt = [number, number];
type Stroke = { id: string; by: string; tool: "pen" | "highlighter" | "line" | "arrow" | "rect" | "ellipse" | "text"; color: string; width: number; points: Pt[]; text?: string };
type Op = { t: "add"; s: Stroke } | { t: "del"; ids: string[] } | { t: "clear" } | { t: "draft"; s: Stroke | null } | { t: "sync?" };

const TOPIC = "wb";
const SYNC_TOPIC = "wb-sync";
const COLORS = ["#1B2440", "#F06A1A", "#C42B2B", "#15803D", "#2B4C9B", "#8A5A00"];
const PEN = 0.004;

const send = (room: Room, op: Op, to?: string[]) =>
  void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(op)), { reliable: true, topic: TOPIC, destinationIdentities: to }).catch(() => undefined);

function StrokeShape({ s, W, H }: { s: Stroke; W: number; H: number }) {
  const a = s.points[0];
  const b = s.points[s.points.length - 1];
  if (!a || !b) return null;
  const w = Math.max(1, s.width * W);
  const common = { stroke: s.color, strokeWidth: w, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const [x0, y0, x1, y1] = [a[0] * W, a[1] * H, b[0] * W, b[1] * H];
  switch (s.tool) {
    case "pen":
    case "highlighter": {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${(p[0] * W).toFixed(1)} ${(p[1] * H).toFixed(1)}`).join(" ") + (s.points.length === 1 ? ` L${x0 + 0.1} ${y0 + 0.1}` : "");
      return <Path d={d} {...common} strokeOpacity={s.tool === "highlighter" ? 0.35 : 1} />;
    }
    case "line":
      return <Line x1={x0} y1={y0} x2={x1} y2={y1} {...common} />;
    case "arrow": {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = Math.max(10, w * 4);
      const head = [
        [x1, y1],
        [x1 - len * Math.cos(ang - 0.45), y1 - len * Math.sin(ang - 0.45)],
        [x1 - len * Math.cos(ang + 0.45), y1 - len * Math.sin(ang + 0.45)],
      ]
        .map((p) => p.join(","))
        .join(" ");
      return (
        <>
          <Line x1={x0} y1={y0} x2={x1} y2={y1} {...common} />
          <Polygon points={head} fill={s.color} />
        </>
      );
    }
    case "rect":
      return <Rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} {...common} />;
    case "ellipse":
      return <Ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={Math.abs(x1 - x0) / 2} ry={Math.abs(y1 - y0) / 2} {...common} />;
    case "text": {
      if (!s.text) return null;
      const size = Math.max(12, s.width * W * 6);
      const lh = Math.max(14, s.width * W * 7.2);
      return (
        <>
          {s.text.split("\n").map((line, i) => (
            <SvgText key={i} x={x0} y={y0 + i * lh + size * 0.85} fill={s.color} fontSize={size} fontWeight="600">
              {line}
            </SvgText>
          ))}
        </>
      );
    }
  }
}

/**
 * The meeting's whiteboard on the phone: live for everyone (LiveKit data
 * messages, same protocol as the website), late joiners get the board from its
 * owner, and you can draw with the pen and undo your own strokes.
 */
export function Whiteboard({ room, me, owner, ownerName, organizer }: { room: Room; me: string; owner: string; ownerName: string; organizer: string | null }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drafts, setDrafts] = useState<Map<string, Stroke>>(new Map());
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]!);
  const [drawing, setDrawing] = useState(false);
  const strokesRef = useRef<Stroke[]>([]);
  const synced = useRef(me === owner);
  const currentRef = useRef<Stroke | null>(null);
  const lastDraft = useRef(0);
  const sizeRef = useRef(size);
  const colorRef = useRef(color);
  const drawingRef = useRef(drawing);
  useEffect(() => {
    sizeRef.current = size;
    colorRef.current = color;
    drawingRef.current = drawing;
  }, [size, color, drawing]);

  const setAll = useCallback((next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
  }, []);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: Participant, _k?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      let op: Op;
      try {
        op = JSON.parse(new TextDecoder().decode(payload)) as Op;
      } catch {
        return;
      }
      const from = participant.identity;
      if (op.t === "sync?") {
        if (me === owner) void room.localParticipant.sendText(JSON.stringify(strokesRef.current), { topic: SYNC_TOPIC, destinationIdentities: [from] }).catch(() => undefined);
      } else if (op.t === "add") {
        const s = op.s;
        if (!strokesRef.current.some((x) => x.id === s.id)) setAll([...strokesRef.current, s]);
        setDrafts((m) => {
          const n = new Map(m);
          n.delete(from);
          return n;
        });
      } else if (op.t === "del") {
        const ids = new Set(op.ids);
        setAll(strokesRef.current.filter((x) => !ids.has(x.id)));
      } else if (op.t === "clear") {
        // Same rule as the website: only the board owner or the organizer can clear it for everyone.
        if (from !== owner && from !== organizer) return;
        setAll([]);
        setDrafts(new Map());
      } else if (op.t === "draft") {
        const s = op.s;
        setDrafts((m) => {
          const n = new Map(m);
          if (s) n.set(from, s);
          else n.delete(from);
          return n;
        });
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    try {
      room.registerTextStreamHandler(SYNC_TOPIC, async (reader) => {
        try {
          const all = JSON.parse(await reader.readAll()) as Stroke[];
          const known = new Set(strokesRef.current.map((s) => s.id));
          setAll([...all.filter((s) => !known.has(s.id)), ...strokesRef.current]);
          synced.current = true;
        } catch {
          /* ignore malformed board */
        }
      });
    } catch {
      /* a handler is already registered */
    }
    // Joining an existing board: ask its owner for everything drawn so far (retry until it arrives).
    let tries = 0;
    const ask = () => {
      if (synced.current || tries++ >= 5) return;
      send(room, { t: "sync?" }, [owner]);
    };
    ask();
    const retry = setInterval(ask, 1500);
    return () => {
      clearInterval(retry);
      room.off(RoomEvent.DataReceived, onData);
      try {
        room.unregisterTextStreamHandler(SYNC_TOPIC);
      } catch {
        /* already gone */
      }
    };
  }, [me, organizer, owner, room, setAll]);

  // The handlers below run only on touch events (never during render), so reading refs and the clock there is fine.
  const pan = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawingRef.current,
        onMoveShouldSetPanResponder: () => drawingRef.current,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const { w, h } = sizeRef.current;
          if (!w) return;
          const p: Pt = [Math.min(1, Math.max(0, e.nativeEvent.locationX / w)), Math.min(1, Math.max(0, e.nativeEvent.locationY / h))];
          currentRef.current = { id: newId(), by: me, tool: "pen", color: colorRef.current, width: PEN, points: [p] };
          setCurrent(currentRef.current);
        },
        onPanResponderMove: (e) => {
          const s = currentRef.current;
          const { w, h } = sizeRef.current;
          if (!s || !w) return;
          const p: Pt = [Math.min(1, Math.max(0, e.nativeEvent.locationX / w)), Math.min(1, Math.max(0, e.nativeEvent.locationY / h))];
          const next = { ...s, points: [...s.points, p] };
          currentRef.current = next;
          setCurrent(next);
          // eslint-disable-next-line react-hooks/purity
          const t = Date.now();
          if (t - lastDraft.current > 80) {
            lastDraft.current = t;
            send(room, { t: "draft", s: next });
          }
        },
        onPanResponderRelease: () => {
          const s = currentRef.current;
          currentRef.current = null;
          setCurrent(null);
          if (!s) return;
          const rounded = { ...s, points: s.points.map((p) => [Math.round(p[0] * 10000) / 10000, Math.round(p[1] * 10000) / 10000] as Pt) };
          setAll([...strokesRef.current, rounded]);
          send(room, { t: "add", s: rounded });
        },
      }),
    [me, room, setAll],
  );

  function undo() {
    const mine = [...strokesRef.current].reverse().find((s) => s.by === me);
    if (!mine) return;
    setAll(strokesRef.current.filter((s) => s.id !== mine.id));
    send(room, { t: "del", ids: [mine.id] });
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setSize({ w, h: (w * 9) / 16 });
  };

  return (
    <View style={st.wrap}>
      <View style={st.bar}>
        <Text style={st.caption} numberOfLines={1}>
          Whiteboard · {owner === me ? "you" : ownerName}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={drawing ? "Stop drawing" : "Draw"} accessibilityState={{ selected: drawing }} onPress={() => setDrawing((d) => !d)} style={[st.tool, drawing && st.toolOn]}>
          <Pencil size={16} color={drawing ? colors.white : colors.ink800} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo my last stroke" onPress={undo} style={st.tool}>
          <Undo2 size={16} color={colors.ink800} />
        </Pressable>
      </View>
      {drawing ? (
        <View style={st.colors}>
          {COLORS.map((c) => (
            <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: color === c }} onPress={() => setColor(c)} style={[st.swatch, { backgroundColor: c }, color === c && st.swatchOn]} />
          ))}
        </View>
      ) : null}
      <View onLayout={onLayout} style={[st.board, { height: size.h || undefined, aspectRatio: size.h ? undefined : 16 / 9 }]} {...pan.panHandlers}>
        {size.w ? (
          <Svg width={size.w} height={size.h}>
            {strokes.map((s) => (
              <StrokeShape key={s.id} s={s} W={size.w} H={size.h} />
            ))}
            {Array.from(drafts.entries()).map(([k, s]) => (
              <StrokeShape key={`d-${k}`} s={s} W={size.w} H={size.h} />
            ))}
            {current ? <StrokeShape s={current} W={size.w} H={size.h} /> : null}
          </Svg>
        ) : null}
      </View>
      {drawing ? <Text style={st.hint}>Draw with your finger. Tap the pencil again to scroll and use the call.</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: 6 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8 },
  caption: { flex: 1, color: colors.ink200, fontSize: 13, fontWeight: "600" },
  tool: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  toolOn: { backgroundColor: colors.brand600 },
  colors: { flexDirection: "row", gap: 10, paddingVertical: 2 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: colors.white, transform: [{ scale: 1.15 }] },
  board: { width: "100%", backgroundColor: colors.white, borderRadius: 10, overflow: "hidden" },
  hint: { color: colors.ink300, fontSize: 12 },
});
