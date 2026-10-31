import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, enforceRateLimit, handler, requireAdmin, requireServiceClient } from "@/lib/api";
import { requirePublicEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export const POST = handler("admin.resend_invite", async (request: Request, { params }: Params) => {
  const caller = await requireAdmin(request);
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) throw new ApiError("invalid_request", "Invalid user id.");
  enforceRateLimit(`resend:${caller.user.id}:${userId}`, 1, 60_000);

  const admin = requireServiceClient();
  const [{ data: profile }, { data: details }] = await Promise.all([
    admin.from("profiles").select("employment_status").eq("id", userId).maybeSingle(),
    admin.from("profile_details").select("email").eq("user_id", userId).maybeSingle(),
  ]);
  if (!profile || !details) throw new ApiError("not_found", "That person no longer exists.");
  if (profile.employment_status !== "invited") {
    throw new ApiError("conflict", "This person has already accepted their invitation.");
  }

  const { siteUrl } = requirePublicEnv();
  const { error } = await admin.auth.admin.inviteUserByEmail(details.email, {
    redirectTo: `${siteUrl}/auth/callback?next=/accept-invite`,
  });
  if (error) {
    logger.warn("admin.resend_invite_failed", { actor: caller.user.id, target: userId, status: error.status ?? null });
    throw new ApiError("server_error", "The invitation couldn't be re-sent. Try again later.");
  }

  await admin.from("audit_logs").insert({
    actor_id: caller.user.id,
    action: "user.invite_resent",
    target_type: "user",
    target_id: userId,
  });
  return NextResponse.json({ ok: true });
});
