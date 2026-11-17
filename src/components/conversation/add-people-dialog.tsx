"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

/**
 * From a one-to-one chat: add people by moving to a group chat with everyone.
 * Reuses an existing group with exactly the same members instead of creating a duplicate.
 */
export function AddPeopleDialog({ open, existingIds, onClose }: { open: boolean; existingIds: string[]; onClose: () => void }) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setPicked([]);
    setError(null);
    onClose();
  }

  async function go() {
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    // existingIds[0] is me; the group is me + the other person + the people picked.
    const members = Array.from(new Set([...existingIds.slice(1), ...picked.map((p) => p.id)]));
    const found = await supabase.rpc("find_group_conversation", { p_member_ids: members });
    const result = found.data
      ? { data: found.data, error: null }
      : await supabase.rpc("create_group_conversation", { p_member_ids: members, p_title: null });
    setBusy(false);
    if (result.error || !result.data) {
      setError(friendlyError(result.error, "Couldn't add people."));
      return;
    }
    close();
    router.push(`/chat/${result.data}`);
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy}
      title="Add people"
      description="This starts a group chat with everyone. Your one-to-one chat stays as it is."
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void go()} loading={busy} disabled={picked.length === 0}>
            Continue in group chat
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <PeoplePicker selected={picked} onChange={setPicked} excludeIds={existingIds} max={98} />
      </div>
    </Dialog>
  );
}
