"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isDemoMode, requirePublicEnv } from "@/lib/env";
import { getDemoClient } from "@/lib/demo/client";

export type BrowserSupabase = SupabaseClient<Database>;

let client: BrowserSupabase | null = null;

/** Singleton browser client. Uses the anon key; RLS enforces access. */
export function getSupabaseBrowserClient(): BrowserSupabase {
  if (!client) {
    if (isDemoMode()) {
      // Demo mode implements the subset of the client API this app uses.
      client = getDemoClient() as unknown as BrowserSupabase;
    } else {
      const env = requirePublicEnv();
      client = createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
    }
  }
  return client;
}
