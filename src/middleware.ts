import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getPublicEnv, isDemoMode } from "@/lib/env";
import { buildContentSecurityPolicy, cspHeaderName, cspMode, newNonce } from "@/lib/security-headers";

export async function middleware(request: NextRequest) {
  const mode = cspMode();
  if (mode === "off") return updateSession(request);
  const nonce = newNonce();
  const value = buildContentSecurityPolicy(nonce, {
    supabaseUrl: getPublicEnv()?.supabaseUrl,
    liveKitUrl: process.env.LIVEKIT_URL,
    dev: process.env.NODE_ENV === "development",
    demo: isDemoMode(),
  });
  return updateSession(request, { name: cspHeaderName(mode), value, nonce });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|pglite/|icons/|manifest.webmanifest|sw.js|offline|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|wasm|data)$).*)"],
};
