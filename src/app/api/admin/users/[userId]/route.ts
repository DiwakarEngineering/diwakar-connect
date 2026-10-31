import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handler, parseJson, requireAdmin, requireServiceClient } from "@/lib/api";
import { updateUserSchema } from "@/lib/validation";
import type { Enums } from "@/lib/database.types";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Ban long enough to be effectively permanent until reactivated.
const BAN_DURATION = "876000h";
const PRIVILEGED: Enums<"app_role">[] = ["owner", "admin"];

type Params = { params: Promise<{ userId: string }> };

/**
 * Lifecycle and role changes for one person.
 *  - Admins manage managers and employees; only owners manage admins/owners.
 *  - Nobody changes their own role or status here.
 *  - The organization always keeps at least one active owner.
 * Suspension/deactivation bans the auth user (no new sessions or token refresh)
 * and RLS denies data access immediately because employment_status != 'active'.
 */
export const PATCH = handler("admin.update_user", async (request: Request, { params }: Params) => {
  const caller = await requireAdmin(request);
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) throw new ApiError("invalid_request", "Invalid user id.");
  const input = await parseJson(request, updateUserSchema);
  const admin = requireServiceClient();

  const [{ data: target }, { data: targetRoleRow }] = await Promise.all([
    admin.from("profiles").select("id, employment_status, display_name").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
  ]);
  if (!target) throw new ApiError("not_found", "That person no longer exists.");
  const targetRole = targetRoleRow?.role ?? "employee";
  const isSelf = userId === caller.user.id;

  if ((input.status !== undefined || input.role !== undefined) && isSelf) {
    throw new ApiError("forbidden", "You can't change your own role or account status.");
  }
  if (PRIVILEGED.includes(targetRole) && caller.role !== "owner" && !isSelf) {
    throw new ApiError("forbidden", "Only an owner can change an administrator or owner.");
  }
  if (input.role && PRIVILEGED.includes(input.role) && caller.role !== "owner") {
    throw new ApiError("forbidden", "Only an owner can grant administrator or owner roles.");
  }

  const losingOwner =
    targetRole === "owner" &&
    ((input.role !== undefined && input.role !== "owner") ||
      (input.status !== undefined && input.status !== "active"));
  if (losingOwner) {
    const { data: owners } = await admin.from("user_roles").select("user_id").eq("role", "owner");
    const otherOwnerIds = (owners ?? []).map((o) => o.user_id).filter((id) => id !== userId);
    const { count } = otherOwnerIds.length
      ? await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .in("id", otherOwnerIds)
          .eq("employment_status", "active")
      : { count: 0 };
    if (!count) throw new ApiError("conflict", "The organization needs at least one active owner.");
  }

  const audits: { action: string; metadata: Record<string, string | string[] | null> }[] = [];

  if (input.status !== undefined && input.status !== target.employment_status) {
    if (target.employment_status === "invited" && input.status === "active") {
      throw new ApiError("conflict", "This person hasn't accepted their invitation yet.");
    }
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: input.status === "active" ? "none" : BAN_DURATION,
    });
    if (banError) {
      logger.error("admin.ban_update_failed", { actor: caller.user.id, target: userId, status: banError.status ?? null });
      throw new ApiError("server_error", "Couldn't update the sign-in account. Nothing was changed.");
    }
    const { error } = await admin.from("profiles").update({ employment_status: input.status }).eq("id", userId);
    if (error) throw new ApiError("server_error", "Couldn't update the account status.");
    const action =
      input.status === "active" ? "user.reactivated" : input.status === "suspended" ? "user.suspended" : "user.deactivated";
    audits.push({ action, metadata: { from: target.employment_status, to: input.status } });
  }

  if (input.role !== undefined && input.role !== targetRole) {
    const { error } = await admin
      .from("user_roles")
      .update({ role: input.role, assigned_by: caller.user.id })
      .eq("user_id", userId);
    if (error) throw new ApiError("server_error", "Couldn't update the role.");
    audits.push({ action: "user.role_changed", metadata: { from: targetRole, to: input.role } });
  }

  const profileUpdate: { display_name?: string; title?: string | null; department_id?: string | null } = {};
  if (input.displayName !== undefined) profileUpdate.display_name = input.displayName;
  if (input.title !== undefined) profileUpdate.title = input.title || null;
  if (input.departmentId !== undefined) profileUpdate.department_id = input.departmentId;
  if (Object.keys(profileUpdate).length > 0) {
    const { error } = await admin.from("profiles").update(profileUpdate).eq("id", userId);
    if (error) throw new ApiError("invalid_request", "Couldn't update the profile. Check the values and try again.");
    audits.push({ action: "user.profile_updated", metadata: { changed: Object.keys(profileUpdate) } });
  }

  if (audits.length > 0) {
    await admin.from("audit_logs").insert(
      audits.map((a) => ({
        actor_id: caller.user.id,
        action: a.action,
        target_type: "user",
        target_id: userId,
        metadata: a.metadata,
      })),
    );
    logger.info("admin.user_updated", { actor: caller.user.id, target: userId, changes: audits.length });
  }

  return NextResponse.json({ ok: true });
});
