import "server-only";

/**
 * Read a server-only setting. Normally it is in process.env; on Cloudflare
 * Workers we also fall back to the Worker's own bindings (exposed by the
 * OpenNext adapter on a global symbol), so a dashboard variable is never
 * missed. Values are trimmed: pasted values often carry stray spaces.
 */
function serverVar(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  const ctx = (globalThis as Record<symbol, { env?: Record<string, unknown> } | undefined>)[
    Symbol.for("__cloudflare-context__")
  ];
  const fromWorker = ctx?.env?.[name];
  return typeof fromWorker === "string" && fromWorker.trim() ? fromWorker.trim() : undefined;
}

export function getServiceRoleKey(): string | null {
  const key = serverVar("SUPABASE_SERVICE_ROLE_KEY");
  // The .env.example placeholder counts as "not configured".
  return key && !/^your-/.test(key) ? key : null;
}

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

export const LIVEKIT_VARS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

/** Names (never values) of the LiveKit settings the server cannot see. */
export function missingLiveKitVars(): string[] {
  return LIVEKIT_VARS.filter((name) => !serverVar(name));
}

/** Returns null when calls are not configured; the UI then shows a setup state. */
export function getLiveKitConfig(): LiveKitConfig | null {
  const url = serverVar("LIVEKIT_URL");
  const apiKey = serverVar("LIVEKIT_API_KEY");
  const apiSecret = serverVar("LIVEKIT_API_SECRET");
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

/** LiveKit's server API speaks HTTPS on the same host as the WebSocket URL. */
export function liveKitHttpUrl(url: string): string {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

/**
 * Document conversion (PowerPoint/Word/Excel -> PDF) through a Gotenberg server
 * (https://gotenberg.dev, LibreOffice). Optional: GOTENBERG_URL, and
 * GOTENBERG_BASIC_AUTH as "user:password" if the server is protected.
 */
export function getConversionConfig(): { url: string; basicAuth: string | null } | null {
  const url = serverVar("GOTENBERG_URL");
  if (!url) return null;
  return { url: url.replace(/\/+$/, ""), basicAuth: serverVar("GOTENBERG_BASIC_AUTH") ?? null };
}
