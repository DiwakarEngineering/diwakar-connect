import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
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
