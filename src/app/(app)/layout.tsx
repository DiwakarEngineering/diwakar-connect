import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import type { SessionInfo } from "@/lib/session";
import { AppProviders } from "@/components/providers/app-providers";
import { DemoAppRoot } from "@/components/demo/demo-app-root";

export const dynamic = "force-dynamic";

/**
 * Server gate for the signed-in app: validates the session with Supabase Auth
 * and routes invited / suspended / deactivated people away before rendering.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (isDemoMode()) return <DemoAppRoot>{children}</DemoAppRoot>;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || profile.employment_status !== "active") {
    redirect(profile?.employment_status === "invited" ? "/accept-invite" : "/account-disabled");
  }

  const [{ data: roleRow }, { data: settings }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("organization_settings").select("*").eq("id", true).single(),
  ]);
  if (!settings) redirect("/account-disabled");

  const session: SessionInfo = {
    userId: user.id,
    email: user.email ?? "",
    profile,
    role: roleRow?.role ?? "employee",
    settings,
  };

  return <AppProviders session={session}>{children}</AppProviders>;
}
