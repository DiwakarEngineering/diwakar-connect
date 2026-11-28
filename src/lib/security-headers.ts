/**
 * Content Security Policy (CSP) for every page.
 *
 * - Scripts: only this app's own scripts, proven by a fresh random nonce per
 *   request ('strict-dynamic' lets those scripts load the app's other chunks).
 *   Injected <script> tags and inline event handlers are refused, which is the
 *   main defense against cross-site scripting (XSS).
 * - Network: the browser may talk only to this site, the Supabase project
 *   (API, Realtime websockets, signed file URLs) and LiveKit (calls).
 * - No plugins, no <base> hijacking, forms post only to this site, and the
 *   app can't be framed by other sites (clickjacking).
 *
 * Kill switch without a code change: set the runtime variable CSP_MODE to
 * "report-only" (log violations in the browser console, block nothing) or
 * "off". Default is "enforce".
 */

export type CspMode = "enforce" | "report-only" | "off";

export function cspMode(): CspMode {
  const raw = (process.env.CSP_MODE ?? "").trim().toLowerCase();
  return raw === "off" || raw === "report-only" ? raw : "enforce";
}

export function cspHeaderName(mode: CspMode): string {
  return mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/** 128-bit random nonce, base64 encoded. Works in Node and Workers. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** "https://x.supabase.co" -> ["https://x.supabase.co", "wss://x.supabase.co"] */
function httpAndWs(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const u = new URL(url);
    const host = u.host;
    if (u.protocol === "http:" || u.protocol === "ws:") return [`http://${host}`, `ws://${host}`];
    return [`https://${host}`, `wss://${host}`];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(
  nonce: string,
  opts: { supabaseUrl?: string; liveKitUrl?: string; dev?: boolean; demo?: boolean },
): string {
  const supabase = httpAndWs(opts.supabaseUrl);
  const supabaseHttp = supabase.filter((s) => s.startsWith("http"));
  // LiveKit Cloud picks a regional server at connect time, so allow its domain.
  const liveKit = ["https://*.livekit.cloud", "wss://*.livekit.cloud", ...httpAndWs(opts.liveKitUrl)];

  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (opts.demo) scriptSrc.push("'wasm-unsafe-eval'"); // in-browser PGlite database (local demo only)
  if (opts.dev) scriptSrc.push("'unsafe-eval'"); // Next.js dev server only

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // React style attributes and Next.js font CSS are inline styles.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...supabaseHttp],
    "media-src": ["'self'", "blob:", ...supabaseHttp],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...supabase, ...liveKit, ...(opts.dev ? ["ws:", "wss:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${[...new Set(v)].join(" ")}`);
  if (!opts.dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
