import { NextResponse } from "next/server";
import { TrackSource } from "livekit-server-sdk";
import { ApiError, enforceRateLimit, handler, parseJson, requireActiveUser, requireServiceClient } from "@/lib/api";
import { getRoomService } from "@/lib/calls.server";
import { callModerateSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Meeting moderation: mute one participant, mute everyone, or remove someone.
 * Allowed for the person who started the call (the organizer) and org admins.
 * Muting is enforced by the media server; people can unmute themselves again
 * (as in other meeting apps). Every action is written to the audit log.
 */
export const POST = handler("calls.moderate", async (request: Request) => {
  const caller = await requireActiveUser(request);
  enforceRateLimit(`call-moderate:${caller.user.id}`, 30, 60_000);
  const input = await parseJson(request, callModerateSchema);

  const { data: call } = await caller.supabase
    .from("calls")
    .select("id, room_name, status, started_by, conversation_id")
    .eq("id", input.callId)
    .maybeSingle();
  if (!call || call.status !== "active") throw new ApiError("not_found", "This call has ended.");
  const isAdmin = caller.role === "owner" || caller.role === "admin";
  if (call.started_by !== caller.user.id && !isAdmin) {
    throw new ApiError("forbidden", "Only the organizer or an administrator can do this.");
  }
  if (input.action !== "mute_all" && input.userId === caller.user.id) {
    throw new ApiError("invalid_request", "Use your own controls for yourself.");
  }

  const service = getRoomService();
  if (!service) throw new ApiError("not_configured", "Calling isn't set up.");

  let participants;
  try {
    participants = await service.listParticipants(call.room_name);
  } catch {
    throw new ApiError("not_found", "This call has ended.");
  }
  const targets =
    input.action === "mute_all"
      ? participants.filter((p) => p.identity !== caller.user.id)
      : participants.filter((p) => p.identity === input.userId);
  if (input.action !== "mute_all" && targets.length === 0) throw new ApiError("not_found", "That person isn't in the call.");

  let affected = 0;
  if (input.action === "remove") {
    await service.removeParticipant(call.room_name, input.userId);
    const admin = requireServiceClient();
    await admin
      .from("call_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("call_id", call.id)
      .eq("user_id", input.userId)
      .is("left_at", null);
    affected = 1;
  } else {
    for (const p of targets) {
      for (const t of p.tracks) {
        if (t.source === TrackSource.MICROPHONE && !t.muted) {
          await service.mutePublishedTrack(call.room_name, p.identity, t.sid, true);
          affected++;
        }
      }
    }
  }

  const admin = requireServiceClient();
  await admin.from("audit_logs").insert({
    actor_id: caller.user.id,
    action: input.action === "remove" ? "call.remove_participant" : input.action === "mute" ? "call.mute_participant" : "call.mute_all",
    target_type: "call",
    target_id: call.id,
    metadata: { conversation_id: call.conversation_id, ...(input.action === "mute_all" ? {} : { user_id: input.userId }), affected },
  });
  logger.info("calls.moderated", { user: caller.user.id, call: call.id, action: input.action, affected });
  return NextResponse.json({ ok: true, affected });
});
