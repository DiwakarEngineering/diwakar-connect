import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, handler, parseJson, requireActiveUser, requireServiceClient } from "@/lib/api";
import { callInviteSchema } from "@/lib/validation";
import { friendlyError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Invites people into an ongoing call. Group chats gain the invitees as members;
 * channels can only invite people who already have access. Direct chats can't
 * take extra people - start a group chat instead.
 */
export const POST = handler("calls.invite", async (request: Request) => {
  const caller = await requireActiveUser(request);
  enforceRateLimit(`call-invite:${caller.user.id}`, 10, 60_000);
  const { callId, userIds } = await parseJson(request, callInviteSchema);

  const { data: call } = await caller.supabase
    .from("calls")
    .select("id, conversation_id, status")
    .eq("id", callId)
    .maybeSingle();
  if (!call || call.status !== "active") throw new ApiError("not_found", "This call has ended.");

  const { data: conversation } = await caller.supabase
    .from("conversations")
    .select("id, kind")
    .eq("id", call.conversation_id)
    .single();
  if (!conversation) throw new ApiError("not_found", "Conversation not found.");

  if (conversation.kind === "direct") {
    throw new ApiError("invalid_request", "To add people, start the call from a group chat or channel.");
  }

  if (conversation.kind === "group") {
    const { error } = await caller.supabase.rpc("add_conversation_members", {
      p_conversation_id: conversation.id,
      p_member_ids: userIds,
    });
    if (error) throw new ApiError("forbidden", friendlyError(error));
  }

  const admin = requireServiceClient();
  const invited: string[] = [];
  for (const userId of userIds) {
    if (userId === caller.user.id) continue;
    const { data: hasAccess } = await admin.rpc("user_can_access_conversation", {
      p_conversation: conversation.id,
      p_user: userId,
    });
    if (hasAccess !== true) continue;
    invited.push(userId);
  }

  if (invited.length > 0) {
    await admin.from("notifications").insert(
      invited.map((userId) => ({
        user_id: userId,
        kind: "call" as const,
        actor_id: caller.user.id,
        conversation_id: conversation.id,
        call_id: call.id,
        title: `${caller.displayName} invited you to join a call`.slice(0, 200),
      })),
    );
  }

  return NextResponse.json({ invited: invited.length, skipped: userIds.length - invited.length });
});
