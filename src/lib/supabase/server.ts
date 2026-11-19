import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { requirePublicEnv } from "@/lib/env";

export type ServerSupabase = SupabaseClient<Database>;

/**
 * Supabase client bound to the signed-in user's cookies (anon key + user JWT).
 * Every query runs under that user's RLS policies.
 */
export async function getSupabaseServerClient(): Promise<ServerSupabase> {
  const env = requirePublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session instead.
        }
      },
    },
  });
}

/** "Authorization: Bearer <access token>" from the mobile app, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header.trim()) : null;
  return match?.[1] ?? null;
}

/**
 * Supabase client acting as the mobile app's signed-in user (their access
 * token instead of cookies). Same anon key, so every query runs under that
 * user's RLS policies.
 */
export function getSupabaseTokenClient(accessToken: string): ServerSupabase {
  const env = requirePublicEnv();
  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
