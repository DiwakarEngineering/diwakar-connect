import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, handler, parseJson, requireServiceClient } from "@/lib/api";
import { clientIp, hashSecret, newSecret } from "@/lib/meetings.server";
import { guestJoinSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * External guest asks to join a meeting (no account): meeting ID + passcode +
 * name. Allowed only when the organization permits guest meetings AND the
 * organizer enabled guests for this meeting. The guest waits in the lobby
 * until the organizer admits them.
 */
export const POST = handler("meetings.guest_join", async (request: Request) => {
  enforceRateLimit(`guest-join:${clientIp(request)}`, 8, 10 * 60_000);
  const input = await parseJson(request, guestJoinSchema);
  const admin = requireServiceClient();

  const [{ data: settings }, { data: meeting }] = await Promise.all([
    admin.from("organization_settings").select("allow_guest_meetings").eq("id", true).maybeSingle(),
    admin.from("meetings").select("id, title, starts_at, ends_at, passcode, allow_guests, cancelled_at").eq("code", input.code).maybeSingle(),
  ]);
  // Same message for every failure, so IDs can't be probed.
  const denied = new ApiError("forbidden", "Meeting ID or passcode is incorrect, or this meeting doesn't allow guests.");
  if (!meeting || meeting.passcode !== input.passcode || meeting.cancelled_at || !meeting.allow_guests || !settings?.allow_guest_meetings) throw denied;
  if (new Date(meeting.ends_at).getTime() < Date.now() - 2 * 3600_000) throw new ApiError("forbidden", "This meeting has ended.");

  const secret = newSecret();
  const { data: row, error } = await admin
    .from("meeting_lobby")
    .insert({ meeting_id: meeting.id, guest_name: input.name, secret_hash: hashSecret(secret) })
    .select("id")
    .single();
  if (error || !row) throw new ApiError("server_error", "Couldn't send your request. Please try again.");
  logger.info("meetings.guest_requested", { meeting: meeting.id });
  return NextResponse.json({ requestId: row.id, secret, title: meeting.title, startsAt: meeting.starts_at });
});
