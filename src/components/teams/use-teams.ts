"use client";

import { useCallback, useEffect, useState } from "react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useActivity } from "@/components/providers/activity-provider";

export type ChannelRow = RpcRow<"list_my_channels">;
export type TeamRow = RpcRow<"list_teams">;

/** Channels in teams the user belongs to, grouped by team, with unread counts. */
export function useMyChannels() {
  const { messageTick } = useActivity();
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseBrowserClient().rpc("list_my_channels");
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load your teams."));
      return;
    }
    setError(null);
    setRows(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load, messageTick]);

  return { rows, error, reload: load };
}

export function useTeamsDirectory() {
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseBrowserClient().rpc("list_teams");
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load teams."));
      return;
    }
    setError(null);
    setRows(data ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, error, reload: load };
}

export function groupByTeam(rows: ChannelRow[]) {
  const teams = new Map<string, { teamId: string; teamName: string; archived: boolean; channels: ChannelRow[] }>();
  for (const r of rows) {
    const t = teams.get(r.team_id) ?? { teamId: r.team_id, teamName: r.team_name, archived: r.team_archived, channels: [] };
    t.channels.push(r);
    teams.set(r.team_id, t);
  }
  return Array.from(teams.values());
}
