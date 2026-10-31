import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, isDemoMode } from "@/lib/env";

// Pages that render their own signed-out / expired-link states.
const PUBLIC_PATHS = ["/sign-in", "/forgot-password", "/reset-password", "/accept-invite", "/account-disabled", "/auth/", "/setup"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

/** Refreshes the Supabase session cookie and gates app routes behind sign-in. */
export async function updateSession(request: NextRequest) {
  // Demo mode keeps its session in the browser; pages gate themselves client-side.
  if (isDemoMode()) return NextResponse.next();

  const env = getPublicEnv();
  const { pathname, search } = request.nextUrl;

  if (!env) {
    // Without configuration only the setup page can render usefully.
    if (pathname.startsWith("/setup") || pathname.startsWith("/api/")) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
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
