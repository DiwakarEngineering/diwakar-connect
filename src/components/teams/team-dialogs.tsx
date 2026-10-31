"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { newId } from "@/lib/uuid";
import { channelSchema, teamSchema } from "@/lib/validation";

type TeamForm = { name: string; description: string; visibility: "public" | "private" };

/** Create a team, or edit an existing one's name/description/visibility. */
export function TeamDialog({
  open,
  onClose,
  team,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  team?: Tables<"teams">;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { session } = useSession();
  const { push } = useToast();
  const [form, setForm] = useState<TeamForm>({ name: "", description: "", visibility: "public" });
  const [errors, setErrors] = useState<Partial<Record<keyof TeamForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: team?.name ?? "", description: team?.description ?? "", visibility: team?.visibility ?? "public" });
      setErrors({});
      setError(null);
    }
  }, [open, team]);

  async function save() {
    const parsed = teamSchema.safeParse(form);
    if (!parsed.success) {
      const e: typeof errors = {};
      for (const issue of parsed.error.issues) e[issue.path[0] as keyof TeamForm] = issue.message;
      setErrors(e);
      return;
    }
    setErrors({});
    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const values = { name: parsed.data.name, description: parsed.data.description || null, visibility: parsed.data.visibility };
    if (team) {
      const { error: updateError } = await supabase.from("teams").update(values).eq("id", team.id);
      setBusy(false);
      if (updateError) return setError(friendlyError(updateError));
      push({ tone: "success", title: "Team updated" });
      onSaved?.();
      onClose();
      return;
    }
    // Ids are generated here so the insert doesn't need to read the row back.
    const id = newId();
    const { error: insertError } = await supabase.from("teams").insert({ id, ...values, created_by: session.userId });
    setBusy(false);
    if (insertError) {
      return setError(insertError.code === "23505" ? "A team with that name already exists." : friendlyError(insertError));
    }
    push({ tone: "success", title: `${values.name} created`, description: "A General channel was added automatically." });
    onSaved?.();
    onClose();
    router.push(`/teams/${id}`);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={team ? "Edit team" : "Create a team"}
      description={team ? undefined : "Teams group people and channels around a site, project or department."}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {team ? "Save changes" : "Create team"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Team name" error={errors.name}>
          <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. O&M Rajasthan" />
        </Field>
        <Field label="Description" optional error={errors.description}>
          <Textarea rows={3} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field
          label="Visibility"
          hint={
            form.visibility === "public"
              ? "Anyone at the company can find and join this team."
              : "Only people added by a team owner can see this team."
          }
        >
          <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as TeamForm["visibility"] })}>
            <option value="public">Public within the company</option>
            <option value="private">Private</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

type ChannelForm = { name: string; description: string; visibility: "standard" | "private" };

export function ChannelDialog({
  open,
  onClose,
  teamId,
  channel,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  teamId: string;
  channel?: Tables<"channels">;
  onSaved?: () => void;
}) {
  const { push } = useToast();
  const [form, setForm] = useState<ChannelForm>({ name: "", description: "", visibility: "standard" });
  const [errors, setErrors] = useState<Partial<Record<keyof ChannelForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: channel?.name ?? "", description: channel?.description ?? "", visibility: channel?.visibility ?? "standard" });
      setErrors({});
      setError(null);
    }
  }, [channel, open]);

  async function save() {
    const parsed = channelSchema.safeParse(form);
    if (!parsed.success) {
      const e: typeof errors = {};
      for (const issue of parsed.error.issues) e[issue.path[0] as keyof ChannelForm] = issue.message;
      setErrors(e);
      return;
    }
    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const values = { name: parsed.data.name, description: parsed.data.description || null, visibility: parsed.data.visibility };
    const { error: saveError } = channel
      ? await supabase.from("channels").update(values).eq("id", channel.id)
      : await supabase.from("channels").insert({ id: newId(), team_id: teamId, ...values });
    setBusy(false);
    if (saveError) {
      return setError(saveError.code === "23505" ? "This team already has a channel with that name." : friendlyError(saveError));
    }
    push({ tone: "success", title: channel ? "Channel updated" : `#${values.name} created` });
    onSaved?.();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={channel ? "Edit channel" : "Create a channel"}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {channel ? "Save changes" : "Create channel"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Channel name" error={errors.name}>
          <Input
            value={form.name}
            maxLength={50}
            disabled={channel?.is_general}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Daily reports"
          />
        </Field>
        <Field label="Description" optional error={errors.description}>
          <Textarea rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field
          label="Who can see it"
          hint={
            form.visibility === "standard"
              ? "Everyone in the team."
              : "Only people you add (they must already be in the team). You're added automatically."
          }
        >
          <Select
            value={form.visibility}
            disabled={channel?.is_general}
            onChange={(e) => setForm({ ...form, visibility: e.target.value as ChannelForm["visibility"] })}
          >
            <option value="standard">Standard - all team members</option>
            <option value="private">Private - selected members</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
