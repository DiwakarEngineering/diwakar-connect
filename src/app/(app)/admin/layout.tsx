import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { PermissionDenied } from "@/components/ui/states";
import { AdminNav } from "@/components/admin/admin-nav";
import { ClientAdminGate } from "@/components/admin/client-admin-gate";

export const dynamic = "force-dynamic";

const DENIED = (
  <div className="flex h-full items-center justify-center">
    <PermissionDenied message="The admin console is available to organization owners and administrators." />
  </div>
);

/** Server-side gate. Data access is independently enforced by RLS and the admin API. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (isDemoMode()) {
    // The demo database is in the browser, so the check happens client-side.
    return <ClientAdminGate denied={DENIED}>{frame(children)}</ClientAdminGate>;
  }
  const supabase = await getSupabaseServerClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) return DENIED;
  return frame(children);
}

function frame(children: React.ReactNode) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <h1 className="text-xl font-semibold text-ink-900">Admin console</h1>
        <p className="text-sm text-ink-500">People, roles, departments, teams and organization settings.</p>
        <AdminNav />
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
