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

export function getPublicEnv(): PublicEnv | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return {
    supabaseUrl,
    supabaseAnonKey,
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, ""),
  };
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
