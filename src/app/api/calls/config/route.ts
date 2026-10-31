import { NextResponse } from "next/server";
import { handler, requireActiveUser } from "@/lib/api";
import { getLiveKitConfig } from "@/lib/env.server";

export const dynamic = "force-dynamic";

/** Tells the client whether calling can work, without revealing any secrets. */
export const GET = handler("calls.config", async (request: Request) => {
  const caller = await requireActiveUser(request);
  const { data: settings } = await caller.supabase
    .from("organization_settings")
    .select("calls_enabled")
    .eq("id", true)
    .maybeSingle();
  return NextResponse.json({
    providerConfigured: getLiveKitConfig() !== null,
    enabledByOrganization: settings?.calls_enabled ?? true,
  });
});
