import { NextResponse } from "next/server";
import { ApiError, handler, parseJson, requireActiveUser, requireServiceClient } from "@/lib/api";
import { endCallRecord, liveParticipantCount } from "@/lib/calls.server";
import { callIdSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Records that the caller left. Ends the call when nobody is left in it. */
export const POST = handler("calls.leave", async (request: Request) => {
  const caller = await requireActiveUser(request);
  const { callId } = await parseJson(request, callIdSchema);

  // RLS: the caller must be able to see this call.
  const { data: call } = await caller.supabase
    .from("calls")
    .select("id, room_name, status")
    .eq("id", callId)
    .maybeSingle();
  if (!call) throw new ApiError("not_found", "Call not found.");

  const admin = requireServiceClient();
  await admin
    .from("call_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("call_id", callId)
    .eq("user_id", caller.user.id)
    .is("left_at", null);

  let ended = false;
  if (call.status === "active") {
    const { count } = await admin
      .from("call_participants")
      .select("id", { count: "exact", head: true })
      .eq("call_id", callId)
      .is("left_at", null);
    const live = await liveParticipantCount(call.room_name);
    // LiveKit may still list the caller for a moment after they disconnect.
    if ((count ?? 0) === 0 && (live === null || live <= 1)) {
      await endCallRecord(admin, callId, caller.user.id);
      ended = true;
    }
  }

  return NextResponse.json({ ended });
});
