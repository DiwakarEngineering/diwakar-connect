"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

export type PresenceKind = "available" | "busy" | "call" | "dnd" | "away" | "offline";

/** The icon for a chosen availability (before calls/meetings or being offline are taken into account). */
export const PRESENCE_KIND = { available: "available", busy: "busy", do_not_disturb: "dnd", away: "away", offline: "offline" } as const satisfies Record<string, PresenceKind>;

const FILL: Record<PresenceKind, string> = {
  available: "#15803D",
  busy: "#C42B2B",
  call: "#C42B2B",
  dnd: "#C42B2B",
  away: "#D97706",
  offline: "#FFFFFF",
};

/**
 * Presence mark in the familiar meeting-app style: green tick (available),
 * red (busy / in a call / in a meeting), red with a bar (do not disturb),
 * amber clock (away), white circle with a grey cross (offline).
 */
export function PresenceIcon({ kind, className }: { kind: PresenceKind; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r={kind === "offline" ? 6.75 : 8} fill={FILL[kind]} stroke={kind === "offline" ? "#8A919E" : "none"} strokeWidth={kind === "offline" ? 1.5 : 0} />
      {kind === "available" ? <path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {kind === "dnd" ? <rect x="4" y="7.05" width="8" height="1.9" rx="0.95" fill="#fff" /> : null}
      {kind === "away" ? <path d="M8 4.4V8.3l2.4 1.5" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {kind === "offline" ? <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" fill="none" stroke="#8A919E" strokeWidth="1.5" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** Small label shown immediately on hover/focus (rendered in <body> so lists can't clip it). */
export function HoverLabel({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.top });
  };
  return (
    <span
      className={className}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setPos(null)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              style={{ left: pos.x, top: pos.y - 6 }}
              className={clsx(
                "pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs font-medium text-white shadow-pop",
              )}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
