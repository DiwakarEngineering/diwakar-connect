import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { ZodSchema } from "zod";
import type { Enums } from "@/lib/database.types";
import { getSupabaseServerClient, type ServerSupabase } from "@/lib/supabase/server";
import { getSupabaseAdminClient, type AdminSupabase } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "not_configured"
  | "server_error";

const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  not_configured: 503,
  server_error: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export function apiError(code: ApiErrorCode, message: string, retryAfter?: number) {
  const headers: Record<string, string> = {};
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code], headers });
}

/** Wraps a route handler: maps ApiError to JSON and hides unexpected errors. */
export function handler<Args extends unknown[]>(
  name: string,
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) return apiError(error.code, error.message, error.retryAfter);
      logger.error("api.unhandled_error", {
        route: name,
        error: error instanceof Error ? error.name + ": " + error.message.slice(0, 200) : "unknown",
      });
      return apiError("server_error", "Something went wrong. Please try again.");
    }
  };
}

export async function parseJson<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError("invalid_request", "Request body must be JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ApiError("invalid_request", first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request.");
  }
  return result.data;
}

/** Same-origin check for state-changing requests (defense in depth beyond SameSite cookies). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (host && new URL(origin).host !== host) throw new ApiError("forbidden", "Cross-origin request blocked.");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("forbidden", "Invalid origin.");
  }
}

export type Caller = {
  user: User;
  supabase: ServerSupabase;
  role: Enums<"app_role">;
  displayName: string;
};

/** Authenticated, active employee (validated with Supabase Auth, not just the cookie). */
export async function requireActiveUser(request: Request): Promise<Caller> {
  assertSameOrigin(request);
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError("unauthenticated", "Your session has expired. Please sign in again.");

  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase.from("profiles").select("employment_status, display_name").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
  ]);
  if (!profile || profile.employment_status !== "active") {
    throw new ApiError("forbidden", "Your account is not active.");
  }
  return { user, supabase, role: roleRow?.role ?? "employee", displayName: profile.display_name };
}

export async function requireAdmin(request: Request): Promise<Caller> {
  const caller = await requireActiveUser(request);
  // Re-check through the database helper so the decision matches RLS.
  const { data: isAdmin } = await caller.supabase.rpc("is_admin");
  if (!isAdmin) throw new ApiError("forbidden", "Administrator access required.");
  return caller;
}

export function requireServiceClient(): AdminSupabase {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    throw new ApiError(
      "not_configured",
      "Server is missing SUPABASE_SERVICE_ROLE_KEY, so administrative actions are unavailable.",
    );
  }
  return admin;
}

export function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const result = checkRateLimit(key, limit, windowMs);
  if (!result.ok) {
    throw new ApiError("rate_limited", "Too many requests. Please wait a moment and try again.", result.retryAfter);
  }
}
