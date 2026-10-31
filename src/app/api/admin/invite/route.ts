import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, handler, parseJson, requireAdmin, requireServiceClient } from "@/lib/api";
import { inviteSchema } from "@/lib/validation";
import { requirePublicEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const HOURLY_INVITE_LIMIT = 50;

/** Invites an employee by email. Admin/owner only; owner-only for privileged roles. */
export const POST = handler("admin.invite", async (request: Request) => {
  const caller = await requireAdmin(request);
  enforceRateLimit(`invite:${caller.user.id}`, 15, 60_000);
  const input = await parseJson(request, inviteSchema);

  if ((input.role === "owner" || input.role === "admin") && caller.role !== "owner") {
    throw new ApiError("forbidden", "Only an owner can invite administrators or owners.");
  }

  const admin = requireServiceClient();

  // Durable limit across instances, counted from the audit log.
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", caller.user.id)
    .in("action", ["user.invited", "user.invite_resent"])
    .gte("created_at", since);
  if ((count ?? 0) >= HOURLY_INVITE_LIMIT) {
    throw new ApiError("rate_limited", "Invitation limit reached. Try again in an hour.", 3600);
  }

  // Friendly early check; the database trigger enforces the same rule.
  const { data: settings } = await admin
    .from("organization_settings")
    .select("allowed_email_domains")
    .eq("id", true)
    .single();
  const domain = input.email.split("@")[1] ?? "";
  if (settings && settings.allowed_email_domains.length > 0 && !settings.allowed_email_domains.includes(domain)) {
    throw new ApiError(
      "invalid_request",
      `Only ${settings.allowed_email_domains.map((d) => "@" + d).join(", ")} addresses can be invited.`,
    );
  }

  if (input.departmentId) {
    const { data: dept } = await admin.from("departments").select("id").eq("id", input.departmentId).maybeSingle();
    if (!dept) throw new ApiError("invalid_request", "That department no longer exists.");
  }

  const { siteUrl } = requirePublicEnv();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { display_name: input.displayName },
    redirectTo: `${siteUrl}/auth/callback?next=/accept-invite`,
  });

  if (error || !data.user) {
    const message = error?.message ?? "";
    if (/already.*(registered|exists)/i.test(message)) {
      throw new ApiError("conflict", "Someone with this email already has an account.");
    }
    if (/database error/i.test(message)) {
      throw new ApiError("invalid_request", "This email address can't be invited (check the allowed domains).");
    }
    if (/rate limit/i.test(message)) {
      throw new ApiError("rate_limited", "The email provider's sending limit was reached. Try again later.", 600);
    }
    logger.error("admin.invite_failed", { actor: caller.user.id, status: error?.status ?? null });
    throw new ApiError("server_error", "The invitation couldn't be sent. Check the Supabase email settings.");
  }

  const userId = data.user.id;
  await admin
    .from("profiles")
    .update({
      display_name: input.displayName,
      title: input.title || null,
      department_id: input.departmentId || null,
    })
    .eq("id", userId);
  await admin.from("user_roles").update({ role: input.role, assigned_by: caller.user.id }).eq("user_id", userId);
  await admin.from("audit_logs").insert({
    actor_id: caller.user.id,
    action: "user.invited",
    target_type: "user",
    target_id: userId,
    metadata: { role: input.role, department_id: input.departmentId ?? null },
  });

  logger.info("admin.user_invited", { actor: caller.user.id, target: userId });
  return NextResponse.json({ userId }, { status: 201 });
});
