import "server-only";

import { RoomServiceClient } from "livekit-server-sdk";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { getLiveKitConfig, liveKitHttpUrl } from "@/lib/env.server";
import { logger } from "@/lib/logger";

export function getRoomService(): RoomServiceClient | null {
  const config = getLiveKitConfig();
  if (!config) return null;
  return new RoomServiceClient(liveKitHttpUrl(config.url), config.apiKey, config.apiSecret);
}

/** Number of people LiveKit reports in a room, or null if it can't be determined. */
export async function liveParticipantCount(roomName: string): Promise<number | null> {
  const service = getRoomService();
  if (!service) return null;
  try {
    return (await service.listParticipants(roomName)).length;
  } catch {
    // LiveKit returns an error for rooms that no longer exist.
    return 0;
  }
}

/** Marks a call ended and closes open participant rows. Idempotent. */
export async function endCallRecord(admin: AdminSupabase, callId: string, endedBy: string | null) {
  const now = new Date().toISOString();
  await admin.from("call_participants").update({ left_at: now }).eq("call_id", callId).is("left_at", null);
  const { error } = await admin
    .from("calls")
    .update({ status: "ended", ended_at: now, ended_by: endedBy })
    .eq("id", callId)
    .eq("status", "active");
  if (error) logger.error("calls.end_failed", { call: callId, code: error.code });
}

export async function closeRoom(roomName: string) {
  const service = getRoomService();
  if (!service) return;
  try {
    await service.deleteRoom(roomName);
  } catch {
    // Room already gone.
  }
}
