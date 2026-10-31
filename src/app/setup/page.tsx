import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth/auth-frame";
import { getPublicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Shown only while Supabase environment variables are missing. */
export default function SetupPage() {
  if (getPublicEnv()) redirect("/");
  return (
    <AuthFrame title="Setup needed" subtitle="Diwakar Connect isn't connected to Supabase yet.">
      <div className="space-y-4 text-sm text-ink-700">
        <p>An administrator needs to configure this deployment:</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Create a Supabase project and apply the SQL migrations in <code className="rounded bg-ink-100 px-1">supabase/migrations</code>.</li>
          <li>
            Set <code className="rounded bg-ink-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
            <code className="rounded bg-ink-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
            <code className="rounded bg-ink-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code> (see <code className="rounded bg-ink-100 px-1">.env.example</code>).
          </li>
          <li>Restart or redeploy the app.</li>
        </ol>
        <p className="text-ink-500">Full instructions are in the project README.</p>
      </div>
    </AuthFrame>
  );
}
