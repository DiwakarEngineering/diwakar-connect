"use client";

// DEMO MODE ONLY. Mirrors /api/admin/* (src/app/api/admin) against the
// in-browser database, applying the same authorization rules. In a real
// deployment these run on the server with the service-role key.

import { inviteSchema, updateUserSchema } from "@/lib/validation";
import type { Enums } from "@/lib/database.types";
import { getDemoClient, runAs } from "./client";

const PRIVILEGED: Enums<"app_role">[] = ["owner", "admin"];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

async function caller() {
  const client = getDemoClient();
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  const userId = data.user.id;
  const { rows } = await runAs("postgres", null, (tx) =>
    tx.query<{ status: string; role: Enums<"app_role">; display_name: string }>(
      `select p.employment_status as status, r.role, p.display_name
         from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = $1`,
      [userId],
    ),
  );
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  return { userId, role: row.role };
}

async function audit(actor: string, action: string, targetId: string, metadata: Record<string, unknown>) {
  await runAs("postgres", null, (tx) =>
    tx.query("insert into public.audit_logs (actor_id, action, target_type, target_id, metadata) values ($1, $2, 'user', $3, $4)", [
      actor,
      action,
      targetId,
      metadata,
    ]),
  );
}

async function invite(body: unknown, me: { userId: string; role: Enums<"app_role"> }) {
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const input = parsed.data;
  if (PRIVILEGED.includes(input.role) && me.role !== "owner") {
    return fail(403, "forbidden", "Only an owner can invite administrators or owners.");
  }
  try {
    const userId = await runAs("postgres", null, async (tx) => {
      const exists = await tx.query("select 1 from auth.users where lower(email) = lower($1)", [input.email]);
      if (exists.rows.length) throw Object.assign(new Error("exists"), { code: "exists" });
      const { rows } = await tx.query<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
        input.email,
        { display_name: input.displayName },
      ]);
      const id = rows[0]!.id;
      await tx.query("update public.profiles set display_name = $2, title = $3, department_id = $4 where id = $1", [
        id,
        input.displayName,
        input.title || null,
        input.departmentId || null,
      ]);
      await tx.query("update public.user_roles set role = $2, assigned_by = $3 where user_id = $1", [id, input.role, me.userId]);
      return id;
    });
    await audit(me.userId, "user.invited", userId, { role: input.role, department_id: input.departmentId ?? null, demo: true });
    return json(201, { userId });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "exists") return fail(409, "conflict", "Someone with this email already has an account.");
    if (/not allowed/i.test(err.message ?? "")) return fail(400, "invalid_request", "This email domain isn't allowed (Admin → Settings).");
    return fail(500, "server_error", "The invitation couldn't be created.");
  }
}

async function updateUser(userId: string, body: unknown, me: { userId: string; role: Enums<"app_role"> }) {
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const input = parsed.data;

  const { rows } = await runAs("postgres", null, (tx) =>
    tx.query<{ status: Enums<"employment_status">; role: Enums<"app_role"> }>(
      `select p.employment_status as status, r.role from public.profiles p
         join public.user_roles r on r.user_id = p.id where p.id = $1`,
      [userId],
    ),
  );
  const target = rows[0];
  if (!target) return fail(404, "not_found", "That person no longer exists.");
  const isSelf = userId === me.userId;

  if ((input.status !== undefined || input.role !== undefined) && isSelf) {
    return fail(403, "forbidden", "You can't change your own role or account status.");
  }
  if (PRIVILEGED.includes(target.role) && me.role !== "owner" && !isSelf) {
    return fail(403, "forbidden", "Only an owner can change an administrator or owner.");
  }
  if (input.role && PRIVILEGED.includes(input.role) && me.role !== "owner") {
    return fail(403, "forbidden", "Only an owner can grant administrator or owner roles.");
  }
  const losingOwner =
    target.role === "owner" &&
    ((input.role !== undefined && input.role !== "owner") || (input.status !== undefined && input.status !== "active"));
  if (losingOwner) {
    const others = await runAs("postgres", null, (tx) =>
      tx.query(
        `select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
          where r.role = 'owner' and p.employment_status = 'active' and r.user_id <> $1`,
        [userId],
      ),
    );
    if (others.rows.length === 0) return fail(409, "conflict", "The organization needs at least one active owner.");
  }
  if (input.status && target.status === "invited" && input.status === "active") {
    return fail(409, "conflict", "This person hasn't accepted their invitation yet.");
  }

  const audits: [string, Record<string, unknown>][] = [];
  await runAs("postgres", null, async (tx) => {
    if (input.status !== undefined && input.status !== target.status) {
      await tx.query("update public.profiles set employment_status = $2 where id = $1", [userId, input.status]);
      await tx.query(
        `update auth.users set banned_until = ${input.status === "active" ? "null" : "now() + interval '100 years'"} where id = $1`,
        [userId],
      );
      audits.push([
        input.status === "active" ? "user.reactivated" : input.status === "suspended" ? "user.suspended" : "user.deactivated",
        { from: target.status, to: input.status },
      ]);
    }
    if (input.role !== undefined && input.role !== target.role) {
      await tx.query("update public.user_roles set role = $2, assigned_by = $3 where user_id = $1", [userId, input.role, me.userId]);
      audits.push(["user.role_changed", { from: target.role, to: input.role }]);
    }
    const changed: string[] = [];
    if (input.displayName !== undefined) {
      await tx.query("update public.profiles set display_name = $2 where id = $1", [userId, input.displayName]);
      changed.push("display_name");
    }
    if (input.title !== undefined) {
      await tx.query("update public.profiles set title = $2 where id = $1", [userId, input.title || null]);
      changed.push("title");
    }
    if (input.departmentId !== undefined) {
      await tx.query("update public.profiles set department_id = $2 where id = $1", [userId, input.departmentId]);
      changed.push("department_id");
    }
    if (changed.length) audits.push(["user.profile_updated", { changed }]);
  });
  for (const [action, metadata] of audits) await audit(me.userId, action, userId, metadata);
  return json(200, { ok: true });
}

/** Handles admin API calls in demo mode and returns a Response like fetch() would. */
export async function demoAdminRequest(url: string, method: string, body?: unknown): Promise<Response> {
  const me = await caller();
  if (!me) return fail(401, "unauthenticated", "Your session has expired. Please sign in again.");
  const { data: isAdmin } = await getDemoClient().rpc("is_admin");
  if (!isAdmin) return fail(403, "forbidden", "Administrator access required.");

  if (url === "/api/admin/invite" && method === "POST") return invite(body, me);
  const resend = /^\/api\/admin\/users\/([0-9a-f-]{36})\/resend-invite$/.exec(url);
  if (resend && method === "POST") {
    await audit(me.userId, "user.invite_resent", resend[1]!, { demo: true });
    return json(200, { ok: true });
  }
  const user = /^\/api\/admin\/users\/([0-9a-f-]{36})$/.exec(url);
  if (user && method === "PATCH") return updateUser(user[1]!, body, me);
  return fail(404, "not_found", "Not available in demo mode.");
}
