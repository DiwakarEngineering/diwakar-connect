import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { ApiError, enforceRateLimit, handler, parseJson, requireActiveUser, requireServiceClient } from "@/lib/api";
import { getLiveKitConfig } from "@/lib/env.server";
import { endCallRecord, liveParticipantCount } from "@/lib/calls.server";
import { callTokenSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const STALE_AFTER_MS = 2 * 60_000;

/**
 * Joins (or starts) the call for a conversation and returns a short-lived
 * LiveKit access token. The LiveKit secret never leaves the server.
 */
export const POST = handler("calls.token", async (request: Request) => {
  const caller = await requireActiveUser(request);
  enforceRateLimit(`call-token:${caller.user.id}`, 10, 60_000);
  const input = await parseJson(request, callTokenSchema);

  const livekit = getLiveKitConfig();
  if (!livekit) {
    throw new ApiError(
      "not_configured",
      "Calling isn't set up yet. An administrator needs to add LiveKit credentials to the server.",
    );
  }

  const { data: settings } = await caller.supabase
    .from("organization_settings")
    .select("calls_enabled")
    .eq("id", true)
    .maybeSingle();
  if (settings && !settings.calls_enabled) {
    throw new ApiError("forbidden", "Calls are turned off for your organization.");
  }

  // Authorization runs through the caller's own RLS-bound client.
  const { data: canPost } = await caller.supabase.rpc("can_post_to_conversation", {
    p_conversation: input.conversationId,
  });
  if (!canPost) throw new ApiError("not_found", "Conversation not found, or you can't call into it.");

  const admin = requireServiceClient();

  // Durable limit across server instances.
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await admin
    .from("call_participants")
    .select("id", { count: "exact", head: true })
    .eq("user_id", caller.user.id)
    .gte("joined_at", since);
  if ((count ?? 0) >= 30) {
    throw new ApiError("rate_limited", "Too many call attempts. Please wait a few minutes.", 300);
  }

  let { data: call } = await admin
    .from("calls")
    .select("*")
    .eq("conversation_id", input.conversationId)
    .eq("status", "active")
    .maybeSingle();

  // A call row can outlive its room if everyone closed their tabs.
  if (call && Date.now() - new Date(call.started_at).getTime() > STALE_AFTER_MS) {
    const live = await liveParticipantCount(call.room_name);
    if (live === 0) {
      await endCallRecord(admin, call.id, null);
      call = null;
    }
  }

  if (!call) {
    const { data: created, error } = await admin
      .from("calls")
      .insert({
        conversation_id: input.conversationId,
        started_by: caller.user.id,
        media: input.media,
        room_name: `dc_${randomUUID()}`,
      })
      .select("*")
      .single();
    if (error?.code === "23505") {
      // Someone else started the call at the same moment; join theirs.
      const retry = await admin
        .from("calls")
        .select("*")
        .eq("conversation_id", input.conversationId)
        .eq("status", "active")
        .single();
      call = retry.data;
    } else if (error) {
      logger.error("calls.create_failed", { code: error.code });
      throw new ApiError("server_error", "Couldn't start the call. Please try again.");
    } else {
      call = created;
    }
  }
  if (!call) throw new ApiError("server_error", "Couldn't start the call. Please try again.");

  await admin.from("call_participants").insert({ call_id: call.id, user_id: caller.user.id });

  const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: caller.user.id,
    name: caller.displayName,
    ttl: "2h",
  });
  token.addGrant({
    room: call.room_name,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  logger.info("calls.token_issued", { user: caller.user.id, call: call.id });

  return NextResponse.json({
    token: await token.toJwt(),
    serverUrl: livekit.url,
    call: {
      id: call.id,
      conversationId: call.conversation_id,
      media: call.media,
      startedAt: call.started_at,
      startedBy: call.started_by,
    },
  });
});
