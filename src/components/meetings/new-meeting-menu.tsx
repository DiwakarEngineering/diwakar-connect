"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronDown, Hash, Plus, Zap } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatMeetingCode } from "@/lib/meetings";
import { useSession } from "@/components/providers/session-provider";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { ScheduleDialog } from "./schedule-dialog";

/**
 * One "New meeting" button for everything meeting-related: start one now,
 * schedule one, or join with a meeting ID.
 */
export function NewMeetingMenu({ callsUsable, canSchedule }: { callsUsable: boolean; canSchedule: boolean }) {
  const router = useRouter();
  const { session } = useSession();
  const { push } = useToast();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const digits = code.replace(/\D/g, "").slice(0, 10);

  async function meetNow() {
    setStarting(true);
    const supabase = getSupabaseBrowserClient();
    const start = new Date();
    const { data, error } = await supabase.rpc("create_meeting", {
      p_title: `Meeting with ${session.profile.display_name.split(" ")[0]}`,
      p_starts_at: start.toISOString(),
      p_ends_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
      p_invitee_ids: [],
    });
    if (error || !data) {
      setStarting(false);
      push({ tone: "error", title: "Couldn't start a meeting", description: friendlyError(error) });
      return;
    }
    const { data: m } = await supabase.from("meetings").select("conversation_id").eq("id", data).single();
    setStarting(false);
    if (m) router.push(`/call/${m.conversation_id}?media=video`);
  }

  return (
    <>
      <Menu
        label="New meeting"
        triggerClassName={buttonClass("primary")}
        trigger={
          <>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {starting ? "Starting..." : "New meeting"}
            <ChevronDown className="-mr-1 h-4 w-4 opacity-80" aria-hidden="true" />
          </>
        }
        items={[
          {
            label: "Meet now",
            hint: "Start instantly",
            icon: <Zap className="h-4 w-4" aria-hidden="true" />,
            disabled: !callsUsable || !canSchedule || starting,
            onSelect: () => void meetNow(),
          },
          {
            label: "Schedule a meeting",
            icon: <CalendarPlus className="h-4 w-4" aria-hidden="true" />,
            disabled: !canSchedule,
            onSelect: () => setScheduleOpen(true),
          },
          { type: "separator" },
          {
            label: "Join with a meeting ID",
            icon: <Hash className="h-4 w-4" aria-hidden="true" />,
            onSelect: () => setJoinOpen(true),
          },
        ]}
      />

      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSaved={(id) => {
          setScheduleOpen(false);
          push({ tone: "success", title: "Meeting scheduled" });
          router.push(`/meetings/${id}`);
        }}
      />

      <Dialog
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        size="sm"
        title="Join with a meeting ID"
        description="Enter the 10-digit meeting ID from the invitation. You'll be asked for the passcode if you aren't invited."
        footer={
          <>
            <Button onClick={() => setJoinOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={digits.length !== 10} onClick={() => router.push(`/meet/${digits}`)}>
              Continue
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (digits.length === 10) router.push(`/meet/${digits}`);
          }}
        >
          <Field label="Meeting ID">
            <Input
              value={digits.length > 6 ? formatMeetingCode(digits) : digits}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="123 456 7890"
              className="font-mono tracking-wider"
              autoFocus
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
