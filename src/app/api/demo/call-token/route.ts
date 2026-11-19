import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";

export const dynamic = "force-dynamic";

const schema = z.object({
  identity: z.string().uuid(),
  name: z.string().min(1).max(80),
  conversationId: z.string().uuid(),
  media: z.enum(["audio", "video"]).default("video"),
});

const DEMO_CALL_ID = "00000000-0000-4000-8000-00000000ca11";

/**
 * DEMO MODE ONLY, for testing calls locally against `livekit-server --dev`.
 * Disabled (404) unless NEXT_PUBLIC_DEMO_MODE=true AND NEXT_PUBLIC_DEMO_LIVEKIT_URL
 * points at this machine (ws://localhost or ws://127.0.0.1). Everyone in the local
 * preview joins one shared test room. Never used by a deployment.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_DEMO_LIVEKIT_URL ?? "";
  if (!isDemoMode() || !/^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request." } }, { status: 400 });
  const { identity, name, conversationId, media } = parsed.data;
  const token = new AccessToken(process.env.DEMO_LIVEKIT_API_KEY ?? "devkey", process.env.DEMO_LIVEKIT_API_SECRET ?? "secret", {
    identity,
    name,
    ttl: "2h",
  });
  token.addGrant({ room: "diwakar-demo-room", roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true });
  return NextResponse.json({
    token: await token.toJwt(),
    serverUrl: url,
    call: { id: DEMO_CALL_ID, conversationId, media, startedAt: new Date().toISOString(), startedBy: null },
  });
}
