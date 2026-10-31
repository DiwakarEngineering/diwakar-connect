import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation";

const ALLOWED_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "email_change", "magiclink", "signup"];

/**
 * Server-side verification for the recommended email templates
 * ({{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/accept-invite).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fallbackNext = type === "invite" ? "/accept-invite" : type === "recovery" ? "/reset-password" : "/";
  const next = safeNextPath(searchParams.get("next"), fallbackNext);

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL("/sign-in?reason=link", origin));
}
