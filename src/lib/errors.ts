type MaybeError = { message?: string; code?: string; details?: string | null } | null | undefined;

/**
 * Converts Supabase/PostgREST/network errors into short, actionable text.
 * Database guard triggers raise human-readable messages, which are passed through.
 */
export function friendlyError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const e = error as MaybeError & { name?: string };
  const message = e?.message ?? "";

  if (e?.name === "AuthApiError" || e?.name === "AuthError") {
    if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
    if (/banned/i.test(message)) return "This account has been suspended. Contact your administrator.";
    if (/email not confirmed/i.test(message)) return "Please accept your invitation email before signing in.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (/JWT expired|invalid jwt|refresh token/i.test(message)) {
    return "Your session has expired. Please sign in again.";
  }
  if (e?.code === "42501" || /row-level security|permission denied/i.test(message)) {
    // Guard triggers use 42501 with a specific explanation; RLS denials do not.
    if (message && !/row-level security|permission denied/i.test(message)) return message;
    return "You don't have permission to do that.";
  }
  if (e?.code === "23505") return "That already exists.";
  if (e?.code === "23514" || e?.code === "22023" || e?.code === "P0001") return message || fallback;
  if (message && message.length < 200 && !/syntax|relation|column|function .* does not exist/i.test(message)) {
    return message;
  }
  return fallback;
}

/** Shape returned by our own /api routes. */
export type ApiErrorBody = { error?: { code?: string; message?: string } };

export async function readApiError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return {
      code: body.error?.code ?? "server_error",
      message: body.error?.message ?? `Request failed (${response.status}).`,
    };
  } catch {
    return { code: "server_error", message: `Request failed (${response.status}).` };
  }
}
