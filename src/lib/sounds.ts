"use client";

/** Per-device switch for notification sounds (default on). */
export const SOUNDS_KEY = "dc:sounds";

export function soundsEnabled() {
  try {
    return window.localStorage.getItem(SOUNDS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    window.localStorage.setItem(SOUNDS_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
}

let ctx: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(c: AudioContext, freq: number, start: number, length: number, volume: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/**
 * Short, soft chime generated in the browser (no audio files). Browsers only
 * allow sound after the person has interacted with the page; until then this
 * silently does nothing.
 */
export function playChime(kind: "message" | "mention" = "message") {
  if (!soundsEnabled()) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.01;
  if (kind === "mention") {
    tone(c, 784, t, 0.18, 0.08);
    tone(c, 1047, t + 0.12, 0.28, 0.08);
  } else {
    tone(c, 880, t, 0.22, 0.06);
  }
}

/** Unlock audio on the first interaction so later chimes can play. */
export function primeAudioOnInteraction() {
  if (typeof window === "undefined") return () => {};
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return unlock;
}
