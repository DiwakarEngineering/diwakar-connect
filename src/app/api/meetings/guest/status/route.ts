import { NextResponse } from "next/server";
import { enforceRateLimit, handler, parseJson, requireServiceClient } from "@/lib/api";
import { clientIp, guestToken, loadGuestRequest } from "@/lib/meetings.server";
import { guestRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Guest polls here while waiting. Once admitted and the meeting has started, returns a call token. */
export const POST = handler("meetings.guest_status", async (request: Request) => {
  enforceRateLimit(`guest-status:${clientIp(request)}`, 120, 60_000);
  const { requestId, secret } = await parseJson(request, guestRequestSchema);
  const admin = requireServiceClient();
  const { req, meeting } = await loadGuestRequest(admin, requestId, secret);
  if (meeting.cancelled_at) return NextResponse.json({ status: "rejected", reason: "This meeting was cancelled." });
  if (req.status !== "admitted") return NextResponse.json({ status: req.status, title: meeting.title });

  const { data: call } = await admin.from("calls").select("room_name").eq("conversation_id", meeting.conversation_id).eq("status", "active").maybeSingle();
  if (!call) return NextResponse.json({ status: "admitted", waiting: true, title: meeting.title });
  const { token, serverUrl } = await guestToken(call.room_name, req.id, req.guest_name!);
  return NextResponse.json({ status: "admitted", token, serverUrl, title: meeting.title });
});
