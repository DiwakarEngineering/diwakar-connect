// Public configuration. NEXT_PUBLIC_* values are inlined at build time, so they
// must be referenced literally (not through process.env[name]).

/**
 * Local demo mode: a PostgreSQL database runs inside the browser (PGlite) with
 * the real migrations and local seed data. Never enable in a deployment.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
};

/** Name of the <meta> tag the root layout uses to hand runtime config to the browser. */
export const PUBLIC_ENV_META = "dc-public-env";

/**
 * Server only: read a variable at runtime. On hosts like Cloudflare Workers the
 * NEXT_PUBLIC_* values may be set as runtime variables rather than at build time.
 */
function runtimeVar(name: string): string | undefined {
  if (typeof window !== "undefined") return undefined;
  return process.env[name] || undefined;
}

/** Browser only: config the server rendered into the page (see app/layout.tsx). */
function documentEnv(): Partial<PublicEnv> {
  if (typeof document === "undefined") return {};
  const raw = document.querySelector(`meta[name="${PUBLIC_ENV_META}"]`)?.getAttribute("content");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<PublicEnv>;
  } catch {
    return {};
  }
}

export function getPublicEnv(): PublicEnv | null {
  // Build-time values (inlined by Next.js) win; otherwise use runtime values.
  const fromDoc = documentEnv();
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || runtimeVar("NEXT_PUBLIC_SUPABASE_URL") || fromDoc.supabaseUrl;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || runtimeVar("NEXT_PUBLIC_SUPABASE_ANON_KEY") || fromDoc.supabaseAnonKey;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || runtimeVar("NEXT_PUBLIC_SITE_URL") || fromDoc.siteUrl || "http://localhost:3000";
  return { supabaseUrl, supabaseAnonKey, siteUrl: siteUrl.replace(/\/+$/, "") };
}

export function requirePublicEnv(): PublicEnv {
  const env = getPublicEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
    );
  }
  return env;
}
