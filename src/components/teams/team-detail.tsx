"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Globe2, Hash, Lock, MoreHorizontal, Pencil, Plus, Trash2, UserPlus, Users } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { ChannelDialog, TeamDialog } from "./team-dialogs";

type Data = {
  team: Tables<"teams">;
  channels: Tables<"channels">[];
  members: Tables<"team_members">[];
  canManage: boolean;
};

type Confirm =
  | { kind: "leave" }
  | { kind: "archive-team"; archive: boolean }
  | { kind: "delete-team" }
  | { kind: "remove-member"; userId: string }
  | { kind: "archive-channel"; channel: Tables<"channels">; archive: boolean }
  | { kind: "delete-channel"; channel: Tables<"channels"> };

export function TeamDetail({ teamId }: { teamId: string }) {
  const router = useRouter();
  const { session, isAdmin } = useSession();
  const { refresh: refreshActivity } = useActivity();
  const { push } = useToast();
  const supabase = getSupabaseBrowserClient();
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState(false);
  const [channelDialog, setChannelDialog] = useState<{ channel?: Tables<"channels"> } | null>(null);
  const [addMembers, setAddMembers] = useState(false);
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [privateMembers, setPrivateMembers] = useState<Tables<"channels"> | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: team, error: teamError } = await supabase.from("teams").select("*").eq("id", teamId).maybeSingle();
    if (teamError) {
      setError(friendlyError(teamError));
      setStatus("error");
      return;
    }
    if (!team) {
      setStatus("missing");
      return;
    }
    const [channels, members, manage] = await Promise.all([
      supabase.from("channels").select("*").eq("team_id", teamId).order("is_general", { ascending: false }).order("name"),
      supabase.from("team_members").select("*").eq("team_id", teamId),
      supabase.rpc("can_manage_team", { p_team: teamId }),
    ]);
    setData({ team, channels: channels.data ?? [], members: members.data ?? [], canManage: !!manage.data });
    setStatus("ready");
  }, [supabase, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = usePeopleById(data?.members.map((m) => m.user_id) ?? []);

  if (status === "loading") return <LoadingState label="Loading team" className="h-full" />;
  if (status === "error") return <ErrorState message={error ?? "Couldn't load the team."} onRetry={() => void load()} />;
  if (status === "missing" || !data) {
    return (
      <EmptyState
        icon={<Users className="h-5 w-5" aria-hidden="true" />}
        title="Team not available"
        description="It may be private, deleted, or you're not a member."
        action={
          <Link href="/teams" className="text-sm font-medium text-brand-700 hover:underline">
            Browse teams
          </Link>
        }
        className="h-full"
      />
    );
  }

  const { team, channels, members, canManage } = data;
  const me = members.find((m) => m.user_id === session.userId);
  const archived = !!team.archived_at;
  const sortedMembers = [...members].sort(
    (a, b) =>
      Number(b.role === "owner") - Number(a.role === "owner") ||
      (people.get(a.user_id)?.display_name ?? "").localeCompare(people.get(b.user_id)?.display_name ?? ""),
  );

  async function run(action: () => PromiseLike<{ error: { message: string; code?: string } | null }>, success: string) {
    setBusy(true);
    const { error: actionError } = await action();
    setBusy(false);
    if (actionError) {
      push({ tone: "error", title: "That didn't work", description: friendlyError(actionError) });
      return false;
    }
    push({ tone: "success", title: success });
    setConfirm(null);
    await load();
    refreshActivity();
    return true;
  }

  async function onConfirm() {
    if (!confirm) return;
    switch (confirm.kind) {
      case "leave":
        if (await run(() => supabase.from("team_members").delete().match({ team_id: team.id, user_id: session.userId }), `You left ${team.name}`)) {
          router.push("/teams");
        }
        break;
      case "archive-team":
        await run(
          () => supabase.from("teams").update({ archived_at: confirm.archive ? new Date().toISOString() : null }).eq("id", team.id),
          confirm.archive ? "Team archived" : "Team restored",
        );
        break;
      case "delete-team":
        if (await run(() => supabase.from("teams").delete().eq("id", team.id), "Team deleted")) router.push("/teams");
        break;
      case "remove-member":
        await run(() => supabase.from("team_members").delete().match({ team_id: team.id, user_id: confirm.userId }), "Member removed");
        break;
      case "archive-channel":
        await run(
          () =>
            supabase
              .from("channels")
              .update({ archived_at: confirm.archive ? new Date().toISOString() : null })
              .eq("id", confirm.channel.id),
          confirm.archive ? "Channel archived" : "Channel restored",
        );
        break;
      case "delete-channel":
        await run(() => supabase.from("channels").delete().eq("id", confirm.channel.id), "Channel deleted");
        break;
    }
  }

  async function addPicked() {
    setBusy(true);
    const { error: addError } = await supabase
      .from("team_members")
      .insert(picked.map((p) => ({ team_id: team.id, user_id: p.id })));
    setBusy(false);
    if (addError) {
      push({ tone: "error", title: "Couldn't add members", description: friendlyError(addError) });
      return;
    }
    push({ tone: "success", title: picked.length === 1 ? "Member added" : `${picked.length} members added` });
    setPicked([]);
    setAddMembers(false);
    await load();
  }

  async function setRole(userId: string, role: "owner" | "member") {
    await run(() => supabase.from("team_members").update({ role }).match({ team_id: team.id, user_id: userId }), role === "owner" ? "Made team owner" : "Changed to member");
  }

  const confirmText: Record<Confirm["kind"], { title: string; body: string; label: string }> = {
    leave: { title: `Leave ${team.name}?`, body: "You'll lose access to its channels until someone adds you again.", label: "Leave team" },
    "archive-team": {
      title: confirm?.kind === "archive-team" && !confirm.archive ? "Restore this team?" : "Archive this team?",
      body:
        confirm?.kind === "archive-team" && !confirm.archive
          ? "Members can post again."
          : "Channels become read-only and the team is hidden from browsing. You can restore it later.",
      label: confirm?.kind === "archive-team" && !confirm.archive ? "Restore" : "Archive",
    },
    "delete-team": { title: `Delete ${team.name}?`, body: "All channels and their messages and files are permanently deleted. This can't be undone.", label: "Delete team" },
    "remove-member": {
      title: "Remove member?",
      body: `${confirm?.kind === "remove-member" ? (people.get(confirm.userId)?.display_name ?? "This person") : ""} will lose access to the team's channels.`,
      label: "Remove",
    },
    "archive-channel": {
      title: confirm?.kind === "archive-channel" && !confirm.archive ? "Restore channel?" : "Archive channel?",
      body: confirm?.kind === "archive-channel" && !confirm.archive ? "Members can post again." : "The channel becomes read-only.",
      label: confirm?.kind === "archive-channel" && !confirm.archive ? "Restore" : "Archive",
    },
    "delete-channel": { title: "Delete channel?", body: "Its messages and files are permanently deleted. This can't be undone.", label: "Delete channel" },
  };

  const teamMenu: MenuItem[] = [];
  if (canManage) {
    teamMenu.push({ label: "Edit team", icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditTeam(true) });
    teamMenu.push({
      label: archived ? "Restore team" : "Archive team",
      icon: <Archive className="h-4 w-4" />,
      onSelect: () => setConfirm({ kind: "archive-team", archive: !archived }),
    });
  }
  if (me) teamMenu.push({ label: "Leave team", onSelect: () => setConfirm({ kind: "leave" }) });
  if (isAdmin) {
    teamMenu.push({ type: "separator" });
    teamMenu.push({ label: "Delete team", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setConfirm({ kind: "delete-team" }) });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <Link href="/teams" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800 md:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Teams
      </Link>
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-xl font-semibold text-brand-700">
          {team.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-ink-900">{team.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>
              {team.visibility === "public" ? <Globe2 className="mr-1 h-3 w-3" aria-hidden="true" /> : <Lock className="mr-1 h-3 w-3" aria-hidden="true" />}
              {team.visibility === "public" ? "Public" : "Private"}
            </Badge>
            <Badge>{members.length} members</Badge>
            {me?.role === "owner" ? <Badge tone="brand">You own this team</Badge> : null}
            {archived ? <Badge tone="warning">Archived</Badge> : null}
          </div>
          {team.description ? <p className="mt-2 text-sm text-ink-600">{team.description}</p> : null}
        </div>
        {teamMenu.length > 0 ? (
          <Menu
            label="Team options"
            items={teamMenu}
            trigger={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
            triggerClassName="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-ink-600 hover:bg-canvas"
          />
        ) : null}
      </div>

      <section className="mt-8" aria-labelledby="channels-heading">
        <div className="flex items-center justify-between">
          <h2 id="channels-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Channels
          </h2>
          {canManage && !archived ? (
            <Button size="sm" variant="subtle" onClick={() => setChannelDialog({})}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New channel
            </Button>
          ) : null}
        </div>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {channels.map((c) => {
            const items: MenuItem[] = [];
            if (canManage) {
              items.push({ label: "Edit", icon: <Pencil className="h-4 w-4" />, onSelect: () => setChannelDialog({ channel: c }) });
              if (c.visibility === "private") items.push({ label: "Manage members", icon: <UserPlus className="h-4 w-4" />, onSelect: () => setPrivateMembers(c) });
              if (!c.is_general) {
                items.push({
                  label: c.archived_at ? "Restore" : "Archive",
                  icon: <Archive className="h-4 w-4" />,
                  onSelect: () => setConfirm({ kind: "archive-channel", channel: c, archive: !c.archived_at }),
                });
                items.push({ type: "separator" });
                items.push({ label: "Delete", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setConfirm({ kind: "delete-channel", channel: c }) });
              }
            }
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                  {c.visibility === "private" ? <Lock className="h-4 w-4" aria-label="Private" /> : <Hash className="h-4 w-4" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  {me || c.visibility === "private" ? (
                    <Link href={`/teams/${team.id}/${c.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-ink-900">{c.name}</span>
                  )}
                  {c.archived_at ? <Badge tone="warning" className="ml-2">Archived</Badge> : null}
                  <p className="truncate text-xs text-ink-500">{c.description || (c.is_general ? "Team-wide channel" : "No description")}</p>
                </div>
                {items.length > 0 ? (
                  <Menu
                    label={`Options for ${c.name}`}
                    items={items}
                    trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                    triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="members-heading">
        <div className="flex items-center justify-between">
          <h2 id="members-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Members
          </h2>
          {canManage && !archived ? (
            <Button size="sm" variant="subtle" onClick={() => setAddMembers(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add members
            </Button>
          ) : null}
        </div>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {sortedMembers.map((m) => {
            const p = people.get(m.user_id);
            const items: MenuItem[] = [];
            if (canManage) {
              items.push(
                m.role === "owner"
                  ? { label: "Make member", onSelect: () => void setRole(m.user_id, "member") }
                  : { label: "Make owner", onSelect: () => void setRole(m.user_id, "owner") },
              );
              if (m.user_id !== session.userId) {
                items.push({ label: "Remove from team", danger: true, onSelect: () => setConfirm({ kind: "remove-member", userId: m.user_id }) });
              }
            }
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={p?.display_name ?? "?"} path={p?.avatar_path} userId={m.user_id} availability={p?.availability} showPresence size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-900">
                    {p?.display_name ?? "Loading..."}
                    {m.user_id === session.userId ? <span className="font-normal text-ink-400"> (you)</span> : null}
                  </div>
                  <div className="truncate text-xs text-ink-500">{p?.title ?? ""}</div>
                </div>
                {m.role === "owner" ? <Badge tone="brand">Owner</Badge> : null}
                {items.length > 0 ? (
                  <Menu
                    label={`Options for ${p?.display_name ?? "member"}`}
                    items={items}
                    trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                    triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <TeamDialog open={editTeam} onClose={() => setEditTeam(false)} team={team} onSaved={() => void load()} />
      <ChannelDialog
        open={channelDialog !== null}
        onClose={() => setChannelDialog(null)}
        teamId={team.id}
        channel={channelDialog?.channel}
        onSaved={() => {
          void load();
          refreshActivity();
        }}
      />
      <Dialog
        open={addMembers}
        onClose={() => setAddMembers(false)}
        busy={busy}
        title={`Add members to ${team.name}`}
        footer={
          <>
            <Button onClick={() => setAddMembers(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={picked.length === 0} onClick={() => void addPicked()}>
              Add {picked.length || ""}
            </Button>
          </>
        }
      >
        <PeoplePicker selected={picked} onChange={setPicked} excludeIds={members.map((m) => m.user_id)} />
      </Dialog>
      {privateMembers ? (
        <PrivateChannelMembers
          channel={privateMembers}
          teamMemberIds={members.map((m) => m.user_id)}
          onClose={() => setPrivateMembers(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        busy={busy}
        title={confirm ? confirmText[confirm.kind].title : ""}
        description={confirm ? confirmText[confirm.kind].body : ""}
        confirmLabel={confirm ? confirmText[confirm.kind].label : ""}
        tone={confirm?.kind === "archive-team" || confirm?.kind === "archive-channel" ? "primary" : "danger"}
        onConfirm={() => void onConfirm()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function PrivateChannelMembers({
  channel,
  teamMemberIds,
  onClose,
}: {
  channel: Tables<"channels">;
  teamMemberIds: string[];
  onClose: () => void;
}) {
  const { push } = useToast();
  const supabase = getSupabaseBrowserClient();
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const people = usePeopleById(memberIds ?? []);

  const load = useCallback(async () => {
    const { data } = await supabase.from("channel_members").select("user_id").eq("channel_id", channel.id);
    setMemberIds((data ?? []).map((m) => m.user_id));
  }, [channel.id, supabase]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    const { error } = await supabase.from("channel_members").insert(picked.map((p) => ({ channel_id: channel.id, user_id: p.id })));
    setBusy(false);
    if (error) return push({ tone: "error", title: "Couldn't add people", description: friendlyError(error) });
    setPicked([]);
    void load();
  }

  async function remove(userId: string) {
    const { error } = await supabase.from("channel_members").delete().match({ channel_id: channel.id, user_id: userId });
    if (error) return push({ tone: "error", title: "Couldn't remove", description: friendlyError(error) });
    void load();
  }

  return (
    <Dialog open onClose={onClose} busy={busy} title={`Members of #${channel.name}`} description="Only these team members can see this private channel." size="lg"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Current members</h3>
          {memberIds === null ? (
            <LoadingState />
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {memberIds.map((id) => (
                <li key={id} className="flex items-center gap-2 px-3 py-2">
                  <Avatar name={people.get(id)?.display_name ?? "?"} path={people.get(id)?.avatar_path} userId={id} size="xs" />
                  <span className="flex-1 truncate text-sm">{people.get(id)?.display_name ?? "..."}</span>
                  <button type="button" onClick={() => void remove(id)} className="text-xs font-medium text-danger-600 hover:underline">
                    Remove
                  </button>
                </li>
              ))}
              {memberIds.length === 0 ? <li className="px-3 py-4 text-center text-sm text-ink-500">No members.</li> : null}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Add team members</h3>
          <PeoplePicker selected={picked} onChange={setPicked} excludeIds={memberIds ?? []} restrictToIds={teamMemberIds} />
          <Button className="mt-3" variant="primary" size="sm" disabled={picked.length === 0} loading={busy} onClick={() => void add()}>
            Add {picked.length || ""}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
