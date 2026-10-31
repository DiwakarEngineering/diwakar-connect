"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";
import { useSession } from "@/components/providers/session-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

/** Start a direct chat (one person) or a group chat (several people). */
export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { session } = useSession();
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setPicked([]);
    setTitle("");
    setError(null);
    onClose();
  }

  async function start() {
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const result =
      picked.length === 1
        ? await supabase.rpc("get_or_create_direct_conversation", { p_other_user: picked[0]!.id })
        : await supabase.rpc("create_group_conversation", {
            p_member_ids: picked.map((p) => p.id),
            p_title: title.trim() || null,
          });
    setBusy(false);
    if (result.error || !result.data) {
      setError(friendlyError(result.error, "Couldn't start the chat."));
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
      title="New chat"
      description="Pick one person for a direct chat, or several for a group."
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void start()} loading={busy} disabled={picked.length === 0}>
            {picked.length > 1 ? "Create group" : "Start chat"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <PeoplePicker selected={picked} onChange={setPicked} excludeIds={[session.userId]} max={99} />
        {picked.length > 1 ? (
          <Field label="Group name" optional hint="You can change this later.">
            <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bhojusar site crew" />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
