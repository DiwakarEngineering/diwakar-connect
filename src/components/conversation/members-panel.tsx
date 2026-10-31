"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, UserMinus, UserPlus } from "lucide-react";
import type { Person } from "@/components/providers/people-provider";
import { Avatar, usePresenceState } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { SidePanel } from "./side-panel";
import type { ConversationMeta } from "./types";

function MemberRow({ person, me, action }: { person: Person | undefined; me: string; action?: React.ReactNode }) {
  const presence = usePresenceState(person?.id, person?.availability);
  if (!person) return null;
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <Avatar name={person.display_name} path={person.avatar_path} userId={person.id} availability={person.availability} showPresence size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink-900">
          {person.display_name}
          {person.id === me ? <span className="font-normal text-ink-400"> (you)</span> : null}
        </div>
        <div className="truncate text-xs text-ink-500">{person.status_message || person.title || presence.label}</div>
      </div>
      {action}
    </li>
  );
}

type Props = {
  meta: ConversationMeta;
  people: Map<string, Person>;
  me: string;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
};

/** Member list; group chats can add people, owners can remove, anyone can leave. */
export function MembersPanel({ meta, people, me, onClose, onChanged, onLeft }: Props) {
  const { push } = useToast();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ type: "remove"; userId: string } | { type: "leave" } | null>(null);
  const supabase = getSupabaseBrowserClient();
  const isGroup = meta.kind === "group";
  const sorted = [...meta.memberIds].sort((a, b) =>
    (people.get(a)?.display_name ?? "").localeCompare(people.get(b)?.display_name ?? ""),
  );

  async function addMembers() {
    setBusy(true);
    const { data, error } = await supabase.rpc("add_conversation_members", {
      p_conversation_id: meta.id,
      p_member_ids: picked.map((p) => p.id),
    });
    setBusy(false);
    if (error) {
      push({ tone: "error", title: "Couldn't add people", description: friendlyError(error) });
      return;
    }
    push({ tone: "success", title: data === 1 ? "1 person added" : `${data ?? 0} people added` });
    setPicked([]);
    setAdding(false);
    onChanged();
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    const userId = confirm.type === "leave" ? me : confirm.userId;
    const { error } = await supabase.rpc("remove_conversation_member", { p_conversation_id: meta.id, p_user_id: userId });
    setBusy(false);
    if (error) {
      push({ tone: "error", title: "Couldn't update the group", description: friendlyError(error) });
      return;
    }
    setConfirm(null);
    if (confirm.type === "leave") {
      push({ tone: "success", title: "You left the group" });
      onLeft();
    } else {
      onChanged();
    }
  }

  return (
    <SidePanel title={`Members (${meta.memberIds.length})`} onClose={onClose}>
      {isGroup ? (
        <div className="flex gap-2 border-b border-line p-3">
          <Button size="sm" variant="subtle" onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add people
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm({ type: "leave" })}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Leave
          </Button>
        </div>
      ) : meta.kind === "channel" && meta.team ? (
        <p className="border-b border-line px-4 py-3 text-xs text-ink-500">
          {meta.channel?.visibility === "private" ? "Private channel members." : "Everyone in the team can see this channel."}{" "}
          <Link href={`/teams/${meta.team.id}`} className="font-medium text-brand-700 hover:underline">
            Manage team
          </Link>
        </p>
      ) : null}
      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-2">
        {sorted.map((id) => (
          <MemberRow
            key={id}
            person={people.get(id)}
            me={me}
            action={
              isGroup && meta.canManage && id !== me ? (
                <button
                  type="button"
                  onClick={() => setConfirm({ type: "remove", userId: id })}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                  aria-label={`Remove ${people.get(id)?.display_name ?? "member"}`}
                >
                  <UserMinus className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null
            }
          />
        ))}
      </ul>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        busy={busy}
        title="Add people to the group"
        description="They'll be able to see the full chat history."
        footer={
          <>
            <Button onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void addMembers()} loading={busy} disabled={picked.length === 0}>
              Add {picked.length > 0 ? picked.length : ""}
            </Button>
          </>
        }
      >
        <PeoplePicker selected={picked} onChange={setPicked} excludeIds={meta.memberIds} />
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        busy={busy}
        title={confirm?.type === "leave" ? "Leave this group?" : "Remove from group?"}
        description={
          confirm?.type === "leave"
            ? "You'll stop receiving messages. Someone in the group can add you back."
            : `${confirm?.type === "remove" ? (people.get(confirm.userId)?.display_name ?? "This person") : ""} will lose access to this chat.`
        }
        confirmLabel={confirm?.type === "leave" ? "Leave group" : "Remove"}
        onConfirm={() => void confirmAction()}
        onClose={() => setConfirm(null)}
      />
    </SidePanel>
  );
}
