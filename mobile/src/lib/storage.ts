import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type Entry = { url: string; expiresAt: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();

/** Short-lived signed URL for a private file (attachments: 5 min, avatars: 1 h), cached until near expiry. */
export async function signedUrl(bucket: "attachments" | "avatars", path: string, ttl: number): Promise<string | null> {
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 15_000) return hit.url;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
    inflight.delete(key);
    if (error || !data) return null;
    cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + ttl * 1000 });
    return data.signedUrl;
  })();
  inflight.set(key, p);
  return p;
}

export function useSignedUrl(bucket: "attachments" | "avatars", path: string | null | undefined, ttl: number) {
  const [state, setState] = useState<{ key: string; url: string | null } | null>(null);
  const key = path ? `${bucket}/${path}` : "";
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void signedUrl(bucket, path, ttl).then((url) => {
      if (!cancelled) setState({ key: `${bucket}/${path}`, url });
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, path, ttl]);
  return path && state?.key === key ? state.url : null;
}

/** Same rule as the website: keep letters, digits, dot, dash, underscore, space. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-120);
  return cleaned || "file";
}

/** RFC 4122 v4 id for new messages and file paths. */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
