import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { requirePublicEnv } from "@/lib/env";
import { getServiceRoleKey } from "@/lib/env.server";

export type AdminSupabase = SupabaseClient<Database>;

/**
 * Service-role client. Bypasses RLS - use only in route handlers, only after the
 * caller has been authorized with their own (RLS-bound) client.
 */
export function getSupabaseAdminClient(): AdminSupabase | null {
  const key = getServiceRoleKey();
  if (!key) return null;
  const env = requirePublicEnv();
  return createClient<Database>(env.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
