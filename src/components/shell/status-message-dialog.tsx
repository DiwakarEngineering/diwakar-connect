"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { usePeople } from "@/components/providers/people-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

const SUGGESTIONS = ["On site today", "In a meeting", "Working remotely", "On leave"];

export function StatusMessageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, setProfile } = useSession();
  const { upsert } = usePeople();
  const { push } = useToast();
  const [value, setValue] = useState(session.profile.status_message ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(session.profile.status_message ?? "");
      setError(null);
    }
  }, [open, session.profile.status_message]);

  async function save(next: string | null) {
    setSaving(true);
    setError(null);
    const { data, error: updateError } = await getSupabaseBrowserClient()
      .from("profiles")
      .update({ status_message: next })
      .eq("id", session.userId)
      .select("*")
      .single();
    setSaving(false);
    if (updateError || !data) {
      setError(friendlyError(updateError));
      return;
    }
    setProfile(data);
    upsert(data);
    push({ tone: "success", title: next ? "Status message updated" : "Status message cleared" });
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={saving}
      title="Status message"
      description="Colleagues see this next to your name."
      size="sm"
      footer={
        <>
          {session.profile.status_message ? (
            <Button variant="ghost" onClick={() => void save(null)} disabled={saving} className="mr-auto">
              Clear
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save(value.trim() || null)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError message={error} />
        <Field label="Message" hint={`${value.length}/140`}>
          <Input value={value} maxLength={140} onChange={(e) => setValue(e.target.value)} placeholder="What's happening?" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setValue(s)}
              className="rounded-full border border-line bg-white px-3 py-1 text-xs text-ink-700 hover:border-brand-300 hover:bg-brand-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
