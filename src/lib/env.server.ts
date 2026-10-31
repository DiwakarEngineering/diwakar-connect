import "server-only";

export function getServiceRoleKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // The .env.example placeholder counts as "not configured".
  return key && !/^your-/.test(key) ? key : null;
}

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

/** Returns null when calls are not configured; the UI then shows a setup state. */
export function getLiveKitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

/** LiveKit's server API speaks HTTPS on the same host as the WebSocket URL. */
export function liveKitHttpUrl(url: string): string {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}
