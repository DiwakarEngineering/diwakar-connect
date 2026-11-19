"use client";

import type { LocalParticipant, Participant } from "livekit-client";

/**
 * What a participant is presenting (besides a screen-share track). Stored as a
 * LiveKit participant attribute, so people who join late see the same slide or
 * board, and the server can clear it (organizer "stop presenting").
 */
export type StageShare =
  | { kind: "pdf"; path: string; name: string; page: number; pages: number; controller?: string | null }
  | { kind: "board"; name: string };

/** How a screen share is laid out for everyone (chosen by the presenter). */
export type PresenterMode = "content" | "side" | "pip";

export function readShare(p: Participant): StageShare | null {
  const raw = p.attributes?.share;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StageShare;
    if (v.kind === "pdf" && typeof v.path === "string" && typeof v.page === "number") return v;
    if (v.kind === "board") return v;
  } catch {
    /* ignore malformed attribute */
  }
  return null;
}

export function readPresenterMode(p: Participant): PresenterMode {
  const m = p.attributes?.pmode;
  return m === "side" || m === "pip" ? m : "content";
}

export async function setShare(local: LocalParticipant, share: StageShare | null) {
  await local.setAttributes({ share: share ? JSON.stringify(share) : "" });
}

export async function setPresenterMode(local: LocalParticipant, mode: PresenterMode) {
  await local.setAttributes({ pmode: mode });
}

/** Small JSON data message helpers (reliable delivery). */
export async function sendData(local: LocalParticipant, topic: string, payload: unknown, to?: string[]) {
  await local.publishData(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true, topic, destinationIdentities: to });
}

export function parseData<T>(payload: Uint8Array): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as T;
  } catch {
    return null;
  }
}
