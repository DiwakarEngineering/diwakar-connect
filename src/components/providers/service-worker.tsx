"use client";

import { useEffect } from "react";

/** Registers /sw.js (offline page only; see public/sw.js). Needed for the installable/Android app. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-critical: the app works without it.
    });
  }, []);
  return null;
}
