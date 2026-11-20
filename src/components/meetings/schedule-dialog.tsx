"use client";

import { useEffect, useState } from "react";
import type { RpcRow, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { PeoplePicker, type PickedPerson } from "@/components/people-picker";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function localDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Next half hour from now. */
function nextSlot() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

/** Schedule a meeting, or edit one (organizer/admin). Invitees get a notification and the meeting chat. */
export function ScheduleDialog({
  open,
  meeting,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Editing an existing meeting. */
  meeting?: Tables<"meetings"> | null;
  onClose: () => void;
  onSaved: (meetingId: string) => void;
}) {
  const { session } = useSession();
  const editing = !!meeting;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [channelId, setChannelId] = useState("");
  const [guests, setGuests] = useState(false);
  const [channels, setChannels] = useState<RpcRow<"list_my_channels">[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guestsAllowed = !!session.settings.allow_guest_meetings;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPeople([]);
    if (meeting) {
      const s = new Date(meeting.starts_at);
      setTitle(meeting.title);
      setDate(localDate(s));
      setTime(localTime(s));
      setMinutes(Math.round((new Date(meeting.ends_at).getTime() - s.getTime()) / 60000));
      setDescription(meeting.description ?? "");
      setGuests(meeting.allow_guests);
      setChannelId(meeting.channel_id ?? "");
    } else {
      const s = nextSlot();
      setTitle("");
      setDate(localDate(s));
      setTime(localTime(s));
      setMinutes(30);
      setDescription("");
      setGuests(false);
      setChannelId("");
      void getSupabaseBrowserClient()
        .rpc("list_my_channels")
        .then(({ data }) => setChannels((data ?? []).filter((c) => !c.channel_archived && !c.team_archived)));
    }
  }, [meeting, open]);

  async function save() {
    const starts = new Date(`${date}T${time}`);
    if (!title.trim()) return setError("Give the meeting a title.");
    if (Number.isNaN(starts.getTime())) return setError("Choose a date and start time.");
    if (!editing && starts.getTime() < Date.now() - 5 * 60_000) return setError("The start time is in the past.");
    const ends = new Date(starts.getTime() + minutes * 60_000);
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const ids = people.map((p) => p.id);
    if (editing && meeting) {
      const { error: e } = await supabase.rpc("update_meeting", {
        p_meeting_id: meeting.id,
        p_title: title.trim(),
        p_starts_at: starts.toISOString(),
        p_ends_at: ends.toISOString(),
        p_description: description.trim() || null,
        p_allow_guests: guests,
        p_add_invitee_ids: ids,
      });
      setBusy(false);
      if (e) return setError(friendlyError(e, "Couldn't save the meeting."));
      onSaved(meeting.id);
    } else {
      const { data, error: e } = await supabase.rpc("create_meeting", {
        p_title: title.trim(),
        p_starts_at: starts.toISOString(),
        p_ends_at: ends.toISOString(),
        p_invitee_ids: ids,
        p_description: description.trim() || null,
        p_channel_id: channelId || null,
        p_allow_guests: guests,
      });
      setBusy(false);
      if (e || !data) return setError(friendlyError(e, "Couldn't schedule the meeting."));
      onSaved(data);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={editing ? "Edit meeting" : "Schedule a meeting"}
      description={editing ? "Invitees are told about changes." : "Invitees get a notification, the meeting in their calendar and a meeting chat."}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {editing ? "Save changes" : "Schedule"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Title">
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly O&M review" autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start">
            <Input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Duration">
            <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ""}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!editing && channels.length ? (
          <Field label="Team channel" optional hint="Channel meetings appear in the channel; only its members can join.">
            <Select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">No channel (private meeting chat)</option>
              {channels.map((c) => (
                <option key={c.channel_id} value={c.channel_id}>
                  {c.team_name} › {c.channel_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-800">{editing ? "Invite more people" : "Invite people"}</span>
          <PeoplePicker selected={people} onChange={setPeople} excludeIds={[session.userId]} max={99} />
        </div>
        <Field label="Agenda" optional>
          <textarea
            value={description}
            maxLength={2000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            placeholder="What will you cover?"
          />
        </Field>
        {guestsAllowed || guests ? (
          <div className="rounded-xl border border-line px-3">
            <Switch
              label="Allow external guests"
              description="People without a Diwakar account can join with the meeting ID and passcode. You admit each guest from the lobby."
              checked={guests}
              onChange={setGuests}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
