import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { STATUS_LABEL } from "@/lib/constants";
import { isDemoMode } from "@/lib/env";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function AccountDisabledPage() {
  if (isDemoMode()) return <Disabled status="Not active" />;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?reason=disabled");

  const { data: profile } = await supabase.from("profiles").select("employment_status").eq("id", user.id).maybeSingle();
  if (profile?.employment_status === "active") redirect("/");
  if (profile?.employment_status === "invited") redirect("/accept-invite");

  return <Disabled status={profile ? STATUS_LABEL[profile.employment_status] : "Not set up"} />;
}

function Disabled({ status }: { status: string }) {
  return (
    <AuthFrame title="Account unavailable" subtitle={`Status: ${status}`}>
      <div className="space-y-5">
        <p className="text-sm text-ink-600">
          Your Diwakar Connect access is currently turned off. If you think this is a mistake, contact your administrator or HR
          team. Messages and files remain with the organization.
        </p>
        <SignOutButton />
      </div>
    </AuthFrame>
  );
}
