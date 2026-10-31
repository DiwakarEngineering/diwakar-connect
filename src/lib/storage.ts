"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * Short-lived signed URL for a private object. Cached until shortly before it
 * expires. Attachments use 5 minutes; avatars 1 hour.
 */
export async function getSignedUrl(bucket: "attachments" | "avatars", path: string, ttlSeconds: number) {
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 15_000) return hit.url;
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const { data, error } = await getSupabaseBrowserClient().storage.from(bucket).createSignedUrl(path, ttlSeconds);
    inflight.delete(key);
    if (error || !data) return null;
    cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + ttlSeconds * 1000 });
    return data.signedUrl;
  })();
  inflight.set(key, promise);
  return promise;
}

export function useSignedUrl(bucket: "attachments" | "avatars", path: string | null | undefined, ttlSeconds: number) {
  const [url, setUrl] = useState<string | null>(() => {
    if (!path) return null;
    const hit = cache.get(`${bucket}/${path}`);
    return hit && hit.expiresAt > Date.now() + 15_000 ? hit.url : null;
  });

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    void getSignedUrl(bucket, path, ttlSeconds).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, path, ttlSeconds]);

  return url;
}

export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-120);
  return cleaned || "file";
}
