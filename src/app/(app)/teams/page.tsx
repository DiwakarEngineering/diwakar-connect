"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Globe2, Lock, Plus, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { TeamDialog } from "@/components/teams/team-dialogs";
import { TeamsSidebar } from "@/components/teams/teams-sidebar";
import { useTeamsDirectory, type TeamRow } from "@/components/teams/use-teams";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { canCreateTeams } from "@/lib/session";

export default function TeamsBrowsePage() {
  const router = useRouter();
  const { session } = useSession();
  const { push } = useToast();
  const { rows, error, reload } = useTeamsDirectory();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  async function join(team: TeamRow) {
    setJoining(team.team_id);
    const { error: joinError } = await getSupabaseBrowserClient()
      .from("team_members")
      .insert({ team_id: team.team_id, user_id: session.userId });
    setJoining(null);
    if (joinError) {
      push({ tone: "error", title: `Couldn't join ${team.name}`, description: friendlyError(joinError) });
      return;
    }
    push({ tone: "success", title: `You joined ${team.name}` });
    router.push(`/teams/${team.team_id}`);
  }

  const q = query.trim().toLowerCase();
  const visible = (rows ?? []).filter(
    (t) => !q || t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="min-h-full">
      <div className="border-b border-line md:hidden">
        <TeamsSidebar />
      </div>
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">Browse teams</h2>
            <p className="mt-1 text-sm text-ink-500">Public teams are open to everyone at {session.settings.organization_name}.</p>
          </div>
          {canCreateTeams(session) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create team
            </Button>
          ) : (
            <p className="text-xs text-ink-500">Team creation is limited by your organization&apos;s settings.</p>
          )}
        </div>

        <div className="relative mt-5 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter teams"
            aria-label="Filter teams"
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm"
          />
        </div>

        <div className="mt-5">
          {error ? (
            <ErrorState message={error} onRetry={() => void reload()} />
          ) : rows === null ? (
            <div className="rounded-2xl border border-line bg-white">
              <SkeletonRows rows={4} />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-line bg-white">
              <EmptyState
                icon={<Users className="h-5 w-5" aria-hidden="true" />}
                title={q ? "No teams match" : "No teams yet"}
                description={q ? "Try a different name." : "Create the first team for a site, project or department."}
              />
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((t) => (
                <li key={t.team_id} className="flex flex-col rounded-2xl border border-line bg-white p-4 shadow-card">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-base font-semibold text-brand-700">
                      {t.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-ink-900">{t.name}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone="neutral">
                          {t.visibility === "public" ? <Globe2 className="mr-1 h-3 w-3" aria-hidden="true" /> : <Lock className="mr-1 h-3 w-3" aria-hidden="true" />}
                          {t.visibility === "public" ? "Public" : "Private"}
                        </Badge>
                        <Badge tone="neutral">{t.member_count} members</Badge>
                        {t.archived_at ? (
                          <Badge tone="warning">
                            <Archive className="mr-1 h-3 w-3" aria-hidden="true" />
                            Archived
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 flex-1 text-sm text-ink-600">{t.description || "No description."}</p>
                  <div className="mt-4 flex gap-2">
                    {t.is_member || t.can_manage ? (
                      <Link
                        href={`/teams/${t.team_id}`}
                        className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-800 hover:bg-canvas"
                      >
                        {t.is_member ? "Open" : "Manage"}
                      </Link>
                    ) : null}
                    {!t.is_member && t.visibility === "public" && !t.archived_at ? (
                      <Button size="sm" variant="subtle" loading={joining === t.team_id} onClick={() => void join(t)}>
                        Join team
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <TeamDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => void reload()} />
    </div>
  );
}
