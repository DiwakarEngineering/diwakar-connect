"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Archive, ChevronDown, Compass, Hash, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useSession } from "@/components/providers/session-provider";
import { canCreateTeams } from "@/lib/session";
import { groupByTeam, useMyChannels } from "./use-teams";
import { TeamDialog } from "./team-dialogs";

export function TeamsSidebar() {
  const pathname = usePathname();
  const { session } = useSession();
  const { rows, error, reload } = useMyChannels();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const mayCreate = canCreateTeams(session);

  const teams = rows ? groupByTeam(rows) : [];

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <h1 className="hidden text-lg font-semibold text-ink-900 md:block">Teams</h1>
        <div className="flex gap-2 md:ml-auto">
          <Link
            href="/teams"
            className={clsx(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
              pathname === "/teams" ? "border-brand-200 bg-brand-50 text-brand-700" : "border-line text-ink-700 hover:bg-canvas",
            )}
          >
            <Compass className="h-4 w-4" aria-hidden="true" />
            Browse
          </Link>
          {mayCreate ? (
            <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create
            </Button>
          ) : null}
        </div>
      </div>

      <nav aria-label="Your teams" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-line py-2">
        {error ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : rows === null ? (
          <SkeletonRows rows={5} />
        ) : teams.length === 0 ? (
          <EmptyState
            title="You're not in any teams yet"
            description="Browse public teams to join one, or ask a team owner to add you."
            action={
              <Link href="/teams" className="text-sm font-medium text-brand-700 hover:underline">
                Browse teams
              </Link>
            }
          />
        ) : (
          teams.map((team) => {
            const isCollapsed = collapsed.has(team.teamId);
            const teamUnread = team.channels.reduce((n, c) => n + c.unread_count, 0);
            return (
              <div key={team.teamId} className="px-2 pb-1">
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((s) => {
                        const next = new Set(s);
                        if (next.has(team.teamId)) next.delete(team.teamId);
                        else next.add(team.teamId);
                        return next;
                      })
                    }
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${team.teamName}`}
                    className="flex h-8 w-7 items-center justify-center rounded text-ink-400 hover:text-ink-700"
                  >
                    <ChevronDown className={clsx("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} aria-hidden="true" />
                  </button>
                  <Link
                    href={`/teams/${team.teamId}`}
                    className={clsx(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold",
                      pathname === `/teams/${team.teamId}` ? "bg-brand-50 text-brand-700" : "text-ink-800 hover:bg-canvas",
                    )}
                  >
                    <span className="truncate">{team.teamName}</span>
                    {team.archived ? <Archive className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-label="Archived" /> : null}
                    {isCollapsed && teamUnread > 0 ? <span className="ml-auto h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" /> : null}
                  </Link>
                </div>
                {!isCollapsed ? (
                  <ul className="ml-7 mt-0.5 space-y-0.5">
                    {team.channels.map((c) => {
                      const href = `/teams/${c.team_id}/${c.channel_id}`;
                      const active = pathname === href;
                      const unread = c.unread_count > 0;
                      return (
                        <li key={c.channel_id}>
                          <Link
                            href={href}
                            aria-current={active ? "page" : undefined}
                            className={clsx(
                              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                              active ? "bg-brand-50 font-medium text-brand-700" : unread ? "font-semibold text-ink-900 hover:bg-canvas" : "text-ink-600 hover:bg-canvas",
                              c.channel_archived && "opacity-60",
                            )}
                          >
                            {c.channel_visibility === "private" ? (
                              <Lock className="h-3.5 w-3.5 shrink-0" aria-label="Private channel" />
                            ) : (
                              <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="min-w-0 flex-1 truncate">{c.channel_name}</span>
                            {unread ? <CountBadge count={c.unread_count} /> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
      </nav>
      <TeamDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => void reload()} />
    </div>
  );
}
