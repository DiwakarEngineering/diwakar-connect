"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Hash, MailPlus, MessageSquare, Minus, PhoneCall, Power, Users, UsersRound } from "lucide-react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { StatCard } from "@/components/admin/stat-card";
import { useSession } from "@/components/providers/session-provider";

type Matrix = { capability: string; owner: boolean | string; admin: boolean | string; manager: boolean | string; employee: boolean | string };

function permissionMatrix(teamCreation: "admins" | "managers" | "everyone"): Matrix[] {
  return [
    { capability: "Chat, join public teams, start calls", owner: true, admin: true, manager: true, employee: true },
    {
      capability: "Create teams",
      owner: true,
      admin: true,
      manager: teamCreation !== "admins",
      employee: teamCreation === "everyone",
    },
    { capability: "Manage a team's channels and members", owner: "All teams", admin: "All teams", manager: "Teams they own", employee: "Teams they own" },
    { capability: "Edit / delete own messages", owner: true, admin: true, manager: "Per settings", employee: "Per settings" },
    { capability: "Remove others' messages (moderation, audited)", owner: true, admin: true, manager: false, employee: false },
    { capability: "Invite, suspend, deactivate people", owner: true, admin: "Managers & employees", manager: false, employee: false },
    { capability: "Grant admin / owner roles", owner: true, admin: false, manager: false, employee: false },
    { capability: "Departments, organization settings, audit log", owner: true, admin: true, manager: false, employee: false },
  ];
}

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-success-600" aria-label="Yes" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-ink-300" aria-label="No" />;
  return <span className="text-xs text-ink-600">{value}</span>;
}

export default function AdminOverviewPage() {
  const { session } = useSession();
  const [summary, setSummary] = useState<RpcRow<"admin_usage_summary"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseBrowserClient().rpc("admin_usage_summary");
    if (loadError) return setError(friendlyError(loadError));
    setError(null);
    setSummary(data?.[0] ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : summary === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total people" value={summary.total_users} icon={<Users className="h-5 w-5" />} />
            <StatCard label="Active" value={summary.active_users} icon={<Power className="h-5 w-5" />} />
            <StatCard label="Pending invitations" value={summary.invited_users} icon={<MailPlus className="h-5 w-5" />} />
            <StatCard
              label="Suspended / deactivated"
              value={`${summary.suspended_users} / ${summary.deactivated_users}`}
              icon={<Power className="h-5 w-5" />}
            />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Last 7 days</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Messages sent" value={summary.messages_7d} icon={<MessageSquare className="h-5 w-5" />} />
              <StatCard label="People who posted" value={summary.active_senders_7d} icon={<UsersRound className="h-5 w-5" />} />
              <StatCard label="Calls" value={summary.calls_7d} hint={`${summary.call_minutes_7d} call minutes`} icon={<PhoneCall className="h-5 w-5" />} />
              <StatCard label="Active teams / channels" value={`${summary.teams} / ${summary.channels}`} icon={<Hash className="h-5 w-5" />} />
            </div>
          </div>
        </>
      )}

      <section aria-labelledby="matrix-title">
        <h2 id="matrix-title" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Permission matrix
        </h2>
        <p className="mt-1 text-sm text-ink-500">Enforced by database policies and the server API, not just this interface.</p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Capability</th>
                {["Owner", "Admin", "Manager", "Employee"].map((r) => (
                  <th key={r} scope="col" className="px-4 py-3 text-center font-semibold">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {permissionMatrix(session.settings.team_creation).map((row) => (
                <tr key={row.capability}>
                  <th scope="row" className="px-4 py-3 text-left font-normal text-ink-800">
                    {row.capability}
                  </th>
                  <td className="px-4 py-3 text-center"><Cell value={row.owner} /></td>
                  <td className="px-4 py-3 text-center"><Cell value={row.admin} /></td>
                  <td className="px-4 py-3 text-center"><Cell value={row.manager} /></td>
                  <td className="px-4 py-3 text-center"><Cell value={row.employee} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
