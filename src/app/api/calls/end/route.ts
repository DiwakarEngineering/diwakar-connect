import { NextResponse } from "next/server";
import { ApiError, handler, parseJson, requireActiveUser, requireServiceClient } from "@/lib/api";
import { closeRoom, endCallRecord } from "@/lib/calls.server";
import { callIdSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Ends a call for everyone. Allowed for whoever started it and for org admins. */
export const POST = handler("calls.end", async (request: Request) => {
  const caller = await requireActiveUser(request);
  const { callId } = await parseJson(request, callIdSchema);

  const { data: call } = await caller.supabase
    .from("calls")
    .select("id, room_name, status, started_by")
    .eq("id", callId)
    .maybeSingle();
  if (!call) throw new ApiError("not_found", "Call not found.");

  const isAdmin = caller.role === "owner" || caller.role === "admin";
  if (call.started_by !== caller.user.id && !isAdmin) {
    throw new ApiError("forbidden", "Only the person who started the call can end it for everyone.");
  }

  const admin = requireServiceClient();
  if (call.status === "active") {
    await closeRoom(call.room_name);
    await endCallRecord(admin, call.id, caller.user.id);
    logger.info("calls.ended_for_all", { user: caller.user.id, call: call.id });
  }
  return NextResponse.json({ ended: true });
});
