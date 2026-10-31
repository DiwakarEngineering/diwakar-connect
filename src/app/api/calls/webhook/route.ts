import { NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { getLiveKitConfig } from "@/lib/env.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { endCallRecord } from "@/lib/calls.server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Optional LiveKit webhook (configure https://<site>/api/calls/webhook in LiveKit).
 * Keeps call history accurate when people close tabs without hanging up.
 */
export async function POST(request: Request) {
  const livekit = getLiveKitConfig();
  const admin = getSupabaseAdminClient();
  if (!livekit || !admin) {
    return NextResponse.json({ error: { code: "not_configured", message: "Calls are not configured." } }, { status: 503 });
  }

  const body = await request.text();
  const receiver = new WebhookReceiver(livekit.apiKey, livekit.apiSecret);
  let event;
  try {
    event = await receiver.receive(body, request.headers.get("authorization") ?? undefined);
  } catch {
    logger.warn("calls.webhook_rejected");
    return NextResponse.json({ error: { code: "forbidden", message: "Invalid signature." } }, { status: 401 });
  }

  const roomName = event.room?.name;
  if (!roomName) return NextResponse.json({ ok: true });

  const { data: call } = await admin.from("calls").select("id, status").eq("room_name", roomName).maybeSingle();
  if (!call) return NextResponse.json({ ok: true });

  if (event.event === "participant_left" || event.event === "participant_connection_aborted") {
    const identity = event.participant?.identity;
    if (identity) {
      await admin
        .from("call_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("call_id", call.id)
        .eq("user_id", identity)
        .is("left_at", null);
    }
  } else if (event.event === "room_finished" && call.status === "active") {
    await endCallRecord(admin, call.id, null);
  }

  logger.info("calls.webhook", { event: event.event, call: call.id });
  return NextResponse.json({ ok: true });
}
