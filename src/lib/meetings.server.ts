import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { ApiError } from "@/lib/api";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { getLiveKitConfig } from "@/lib/env.server";

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const newSecret = () => randomBytes(24).toString("base64url");

export function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** A guest's lobby request, verified by its secret (guests have no account). */
export async function loadGuestRequest(admin: AdminSupabase, requestId: string, secret: string) {
  const { data: req } = await admin.from("meeting_lobby").select("*").eq("id", requestId).maybeSingle();
  if (!req || !req.guest_name || !req.secret_hash || req.secret_hash !== hashSecret(secret)) {
    throw new ApiError("not_found", "This request has expired. Open the meeting link again.");
  }
  const { data: meeting } = await admin.from("meetings").select("*").eq("id", req.meeting_id).single();
  if (!meeting) throw new ApiError("not_found", "Meeting not found.");
  return { req, meeting };
}

/**
 * LiveKit token for an admitted guest: camera and microphone only (no screen
 * sharing, no data channel, can't change attributes). Short-lived: it is only
 * needed to connect; LiveKit refreshes the session for as long as they stay.
 */
export async function guestToken(roomName: string, requestId: string, name: string) {
  const config = getLiveKitConfig();
  if (!config) throw new ApiError("not_configured", "Calling isn't set up.");
  const token = new AccessToken(config.apiKey, config.apiSecret, { identity: `guest:${requestId}`, name: `${name} (guest)`, ttl: "5m" });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return { token: await token.toJwt(), serverUrl: config.url };
}
