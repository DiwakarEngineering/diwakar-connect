import { NextResponse } from "next/server";
import { handler, parseJson, requireServiceClient } from "@/lib/api";
import { loadGuestRequest } from "@/lib/meetings.server";
import { guestRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Guest left (or gave up waiting). */
export const POST = handler("meetings.guest_leave", async (request: Request) => {
  const { requestId, secret } = await parseJson(request, guestRequestSchema);
  const admin = requireServiceClient();
  const { req } = await loadGuestRequest(admin, requestId, secret);
  if (req.status === "waiting" || req.status === "admitted") await admin.from("meeting_lobby").update({ status: "left" }).eq("id", req.id);
  return NextResponse.json({ ok: true });
});
