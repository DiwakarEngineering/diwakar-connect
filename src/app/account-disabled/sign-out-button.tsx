"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="primary"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        await getSupabaseBrowserClient().auth.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
