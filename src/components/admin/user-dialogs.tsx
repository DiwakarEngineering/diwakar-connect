"use client";

import { useEffect, useState } from "react";
import type { Enums, RpcRow, Tables } from "@/lib/database.types";
import { ROLE_LABEL } from "@/lib/constants";
import { readApiError } from "@/lib/errors";
import { inviteSchema } from "@/lib/validation";
import { isDemoMode } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";

type Department = Tables<"departments">;
type AdminUser = RpcRow<"admin_list_users">;

function roleOptions(isOwner: boolean): Enums<"app_role">[] {
  return isOwner ? ["employee", "manager", "admin", "owner"] : ["employee", "manager"];
}

export async function callAdminApi(url: string, method: "POST" | "PATCH", body?: unknown) {
  const res = isDemoMode()
    ? await (await import("@/lib/demo/admin-api")).demoAdminRequest(url, method, body)
    : await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
  if (!res.ok) throw new Error((await readApiError(res)).message);
  return res;
}

export function InviteUserDialog({
  open,
  onClose,
  departments,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  departments: Department[];
  onInvited: () => void;
}) {
  const { isOwner, session } = useSession();
  const { push } = useToast();
  const [form, setForm] = useState({ email: "", displayName: "", role: "employee" as Enums<"app_role">, title: "", departmentId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ email: "", displayName: "", role: "employee", title: "", departmentId: "" });
      setErrors({});
      setError(null);
    }
  }, [open]);

  async function submit() {
    const parsed = inviteSchema.safeParse({
      ...form,
      title: form.title || null,
      departmentId: form.departmentId || null,
    });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0])] = issue.message;
      setErrors(e);
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      await callAdminApi("/api/admin/invite", "POST", parsed.data);
      push({ tone: "success", title: `Invitation sent to ${parsed.data.email}` });
      onInvited();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The invitation couldn't be sent.");
    } finally {
      setBusy(false);
    }
  }

  const domains = session.settings.allowed_email_domains;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Invite a person"
      description="They'll get an email to set their password. Accounts can't be created any other way."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Send invitation
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <Field
          label="Work email"
          error={errors.email}
          className="sm:col-span-2"
          hint={domains.length ? `Allowed domains: ${domains.map((d) => "@" + d).join(", ")}` : undefined}
        >
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Full name" error={errors.displayName}>
          <Input value={form.displayName} maxLength={80} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Job title" optional error={errors.title}>
          <Input value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Department" optional>
          <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role" hint={isOwner ? undefined : "Only owners can invite administrators."}>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Enums<"app_role"> })}>
            {roleOptions(isOwner).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  onClose,
  departments,
  onSaved,
}: {
  user: AdminUser | null;
  onClose: () => void;
  departments: Department[];
  onSaved: () => void;
}) {
  const { isOwner, session } = useSession();
  const { push } = useToast();
  const [form, setForm] = useState({ displayName: "", title: "", departmentId: "", role: "employee" as Enums<"app_role"> });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        displayName: user.display_name,
        title: user.title ?? "",
        departmentId: user.department_id ?? "",
        role: user.role ?? "employee",
      });
      setError(null);
    }
  }, [user]);

  if (!user) return null;
  const isSelf = user.id === session.userId;
  const privilegedTarget = user.role === "owner" || user.role === "admin";
  const canChangeRole = !isSelf && (isOwner || !privilegedTarget);
  const options = roleOptions(isOwner);
  if (user.role && !options.includes(user.role)) options.push(user.role);

  async function save() {
    if (!user) return;
    setBusy(true);
    setError(null);
    const body: Record<string, string | null> = {};
    if (form.displayName.trim() !== user.display_name) body.displayName = form.displayName.trim();
    if ((form.title.trim() || null) !== (user.title ?? null)) body.title = form.title.trim() || null;
    if ((form.departmentId || null) !== (user.department_id ?? null)) body.departmentId = form.departmentId || null;
    if (canChangeRole && form.role !== user.role) body.role = form.role;
    if (Object.keys(body).length === 0) {
      setBusy(false);
      onClose();
      return;
    }
    try {
      await callAdminApi(`/api/admin/users/${user.id}`, "PATCH", body);
      push({ tone: "success", title: `${form.displayName.trim() || user.display_name} updated` });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={`Edit ${user.display_name}`}
      description={user.email ?? undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <Field label="Full name">
          <Input value={form.displayName} maxLength={80} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Job title" optional>
          <Input value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Department" optional>
          <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Role"
          hint={isSelf ? "You can't change your own role." : !canChangeRole ? "Only an owner can change an administrator." : undefined}
        >
          <Select value={form.role} disabled={!canChangeRole} onChange={(e) => setForm({ ...form, role: e.target.value as Enums<"app_role"> })}>
            {options.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
