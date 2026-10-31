"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, MailPlus, MoreHorizontal, Search, UserPlus } from "lucide-react";
import type { Enums, RpcRow, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/constants";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { EditUserDialog, InviteUserDialog, callAdminApi } from "@/components/admin/user-dialogs";

type AdminUser = RpcRow<"admin_list_users">;
const PAGE_SIZE = 25;

const STATUS_TONE: Record<Enums<"employment_status">, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  invited: "warning",
  suspended: "danger",
  deactivated: "neutral",
};

type PendingStatus = { user: AdminUser; status: "active" | "suspended" | "deactivated" };

export default function AdminUsersPage() {
  const { session, isOwner } = useSession();
  const { push } = useToast();
  const supabase = getSupabaseBrowserClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | Enums<"employment_status">>("");
  const [role, setRole] = useState<"" | Enums<"app_role">>("");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Tables<"departments">[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [pendingStatus, setPendingStatus] = useState<PendingStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase
      .from("departments")
      .select("*")
      .order("name")
      .then(({ data }) => setDepartments(data ?? []));
  }, [supabase]);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc("admin_list_users", {
      p_query: query.trim() || null,
      p_status: status || null,
      p_role: role || null,
      p_department_id: department || null,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load users."));
      return;
    }
    setError(null);
    setRows(data ?? []);
    setTotal(Number(data?.[0]?.total_count ?? 0));
  }, [department, page, query, role, status, supabase]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [load, query]);

  async function applyStatus() {
    if (!pendingStatus) return;
    setBusy(true);
    try {
      await callAdminApi(`/api/admin/users/${pendingStatus.user.id}`, "PATCH", { status: pendingStatus.status });
      push({ tone: "success", title: `${pendingStatus.user.display_name} is now ${STATUS_LABEL[pendingStatus.status].toLowerCase()}` });
      setPendingStatus(null);
      void load();
    } catch (e) {
      push({ tone: "error", title: "Couldn't change status", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function resend(user: AdminUser) {
    try {
      await callAdminApi(`/api/admin/users/${user.id}/resend-invite`, "POST");
      push({ tone: "success", title: `Invitation re-sent to ${user.email ?? user.display_name}` });
    } catch (e) {
      push({ tone: "error", title: "Couldn't resend invitation", description: e instanceof Error ? e.message : undefined });
    }
  }

  function actionsFor(user: AdminUser): MenuItem[] {
    const isSelf = user.id === session.userId;
    const privileged = user.role === "owner" || user.role === "admin";
    const mayManage = !isSelf && (isOwner || !privileged);
    const items: MenuItem[] = [{ label: "Edit details", onSelect: () => setEditing(user) }];
    if (user.employment_status === "invited") items.push({ label: "Resend invitation", onSelect: () => void resend(user) });
    if (mayManage) {
      if (user.employment_status === "active") {
        items.push({ type: "separator" });
        items.push({ label: "Suspend", onSelect: () => setPendingStatus({ user, status: "suspended" }) });
        items.push({ label: "Deactivate", danger: true, onSelect: () => setPendingStatus({ user, status: "deactivated" }) });
      } else if (user.employment_status === "suspended" || user.employment_status === "deactivated") {
        items.push({ type: "separator" });
        items.push({ label: "Reactivate", onSelect: () => setPendingStatus({ user, status: "active" }) });
        if (user.employment_status === "suspended") {
          items.push({ label: "Deactivate", danger: true, onSelect: () => setPendingStatus({ user, status: "deactivated" }) });
        }
      } else if (user.employment_status === "invited") {
        items.push({ label: "Revoke invitation", danger: true, onSelect: () => setPendingStatus({ user, status: "deactivated" }) });
      }
    }
    return items;
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusCopy: Record<PendingStatus["status"], { title: string; body: string; label: string }> = {
    suspended: {
      title: "Suspend this person?",
      body: "They're signed out of new sessions immediately and lose access to all data. You can reactivate them later.",
      label: "Suspend",
    },
    deactivated: {
      title: "Deactivate this person?",
      body: "Use this when someone leaves the company. They lose access; their messages stay for the organization. You can reactivate them later.",
      label: "Deactivate",
    },
    active: { title: "Reactivate this person?", body: "They'll be able to sign in and access their chats and teams again.", label: "Reactivate" },
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          {total} {total === 1 ? "person" : "people"}
          {status || role || department || query ? " match your filters" : ""}
        </p>
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite people
        </Button>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-white shadow-card">
        <div className="grid gap-2 border-b border-line p-3 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search name, email, title"
              aria-label="Search users"
              className="h-10 w-full rounded-lg border border-line pl-9 pr-3 text-sm"
            />
          </div>
          <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as Enums<"employment_status">[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by role" value={role} onChange={(e) => { setRole(e.target.value as typeof role); setPage(0); }}>
            <option value="">All roles</option>
            {(Object.keys(ROLE_LABEL) as Enums<"app_role">[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(0); }}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : rows === null ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<MailPlus className="h-5 w-5" aria-hidden="true" />}
            title="No people found"
            description={query || status || role || department ? "Try clearing the filters." : "Invite your first colleague."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-semibold">User</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Department</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Role</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Last sign-in</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.display_name} path={u.avatar_path} userId={u.id} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink-900">
                            {u.display_name}
                            {u.id === session.userId ? <span className="font-normal text-ink-400"> (you)</span> : null}
                          </div>
                          <div className="truncate text-xs text-ink-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-ink-800">{u.department_name ?? "—"}</div>
                      <div className="text-xs text-ink-500">{u.title ?? ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.role === "owner" || u.role === "admin" ? "brand" : "neutral"}>{u.role ? ROLE_LABEL[u.role] : "—"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[u.employment_status]}>{STATUS_LABEL[u.employment_status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{relativeTime(u.last_sign_in_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Menu
                        label={`Actions for ${u.display_name}`}
                        items={actionsFor(u)}
                        trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                        triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > PAGE_SIZE ? (
        <nav aria-label="User pages" className="mt-4 flex items-center justify-between text-sm text-ink-600">
          <span>
            Page {page + 1} of {pages}
          </span>
          <span className="flex gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        </nav>
      ) : null}

      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} departments={departments} onInvited={() => void load()} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} departments={departments} onSaved={() => void load()} />
      <ConfirmDialog
        open={pendingStatus !== null}
        busy={busy}
        title={pendingStatus ? statusCopy[pendingStatus.status].title : ""}
        description={
          pendingStatus ? (
            <>
              <strong className="text-ink-800">{pendingStatus.user.display_name}</strong>. {statusCopy[pendingStatus.status].body}
            </>
          ) : (
            ""
          )
        }
        confirmLabel={pendingStatus ? statusCopy[pendingStatus.status].label : ""}
        tone={pendingStatus?.status === "active" ? "primary" : "danger"}
        onConfirm={() => void applyStatus()}
        onClose={() => setPendingStatus(null)}
      />
    </div>
  );
}
