import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, isDemoMode } from "@/lib/env";

// Pages that render their own signed-out / expired-link states.
const PUBLIC_PATHS = ["/sign-in", "/forgot-password", "/reset-password", "/accept-invite", "/account-disabled", "/auth/", "/setup", "/meet/"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

export type SecurityHeader = { name: string; value: string; nonce: string };

/** Refreshes the Supabase session cookie and gates app routes behind sign-in. */
export async function updateSession(request: NextRequest, security?: SecurityHeader) {
  // Continue to the page, passing the CSP nonce to Next.js (it adds the nonce
  // to its own scripts) and setting the policy and caching rules on the response.
  const forward = () => {
    const headers = new Headers(request.headers);
    if (security) {
      headers.set("x-nonce", security.nonce);
      headers.set(security.name.toLowerCase(), security.value);
    }
    const res = NextResponse.next({ request: { headers } });
    if (security) res.headers.set(security.name, security.value);
    // API responses carry private data: never store them in any cache.
    if (request.nextUrl.pathname.startsWith("/api/")) res.headers.set("Cache-Control", "no-store");
    return res;
  };

  // Demo mode keeps its session in the browser; pages gate themselves client-side.
  if (isDemoMode()) return forward();

  const env = getPublicEnv();
  const { pathname, search } = request.nextUrl;

  if (!env) {
    // Without configuration only the setup page can render usefully.
    if (pathname.startsWith("/setup") || pathname.startsWith("/api/")) return forward();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = forward();

  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the JWT with Supabase Auth (getSession() would not).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
