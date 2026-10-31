"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, Globe2, Lock, Users } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useTeamsDirectory, type TeamRow } from "@/components/teams/use-teams";

export default function AdminTeamsPage() {
  const { rows, error, reload } = useTeamsDirectory();
  const { push } = useToast();
  const [pending, setPending] = useState<{ team: TeamRow; action: "archive" | "restore" | "delete" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (!pending) return;
    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const { error: actionError } =
      pending.action === "delete"
        ? await supabase.from("teams").delete().eq("id", pending.team.team_id)
        : await supabase
            .from("teams")
            .update({ archived_at: pending.action === "archive" ? new Date().toISOString() : null })
            .eq("id", pending.team.team_id);
    setBusy(false);
    if (actionError) return push({ tone: "error", title: "That didn't work", description: friendlyError(actionError) });
    push({ tone: "success", title: pending.action === "delete" ? "Team deleted" : pending.action === "archive" ? "Team archived" : "Team restored" });
    setPending(null);
    void reload();
  }

  return (
    <div>
      <p className="text-sm text-ink-500">Administrators can see and manage every team, including private ones. Reading channel messages still requires membership.</p>
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        {error ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : rows === null ? (
          <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" aria-hidden="true" />} title="No teams yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-semibold">Team</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Visibility</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Members</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Created</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((t) => (
                  <tr key={t.team_id}>
                    <td className="px-4 py-3">
                      <Link href={`/teams/${t.team_id}`} className="font-medium text-ink-900 hover:underline">
                        {t.name}
                      </Link>
                      {t.archived_at ? (
                        <Badge tone="warning" className="ml-2">
                          <Archive className="mr-1 h-3 w-3" aria-hidden="true" />
                          Archived
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge>
                        {t.visibility === "public" ? <Globe2 className="mr-1 h-3 w-3" aria-hidden="true" /> : <Lock className="mr-1 h-3 w-3" aria-hidden="true" />}
                        {t.visibility === "public" ? "Public" : "Private"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{t.member_count}</td>
                    <td className="px-4 py-3 text-ink-600">{relativeTime(t.created_at)}</td>
                    <td className="space-x-1 whitespace-nowrap px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setPending({ team: t, action: t.archived_at ? "restore" : "archive" })}>
                        {t.archived_at ? "Restore" : "Archive"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-danger-600" onClick={() => setPending({ team: t, action: "delete" })}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={pending !== null}
        busy={busy}
        title={pending ? `${pending.action === "delete" ? "Delete" : pending.action === "archive" ? "Archive" : "Restore"} ${pending.team.name}?` : ""}
        description={
          pending?.action === "delete"
            ? "All channels, messages and files in this team are permanently deleted."
            : pending?.action === "archive"
              ? "Channels become read-only and the team is hidden from browsing."
              : "Members can post again."
        }
        confirmLabel={pending?.action === "delete" ? "Delete team" : pending?.action === "archive" ? "Archive" : "Restore"}
        tone={pending?.action === "delete" ? "danger" : "primary"}
        onConfirm={() => void apply()}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
