"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { browserSessionEnded, clearRememberChoice } from "@/lib/remember-me";

/** Signs out people who chose not to be remembered once their browser has been closed. */
export function SessionOnlyGuard() {
  useEffect(() => {
    if (!browserSessionEnded()) return;
    void getSupabaseBrowserClient()
      .auth.signOut()
      .finally(() => {
        clearRememberChoice();
        window.location.replace("/sign-in?reason=expired");
      });
  }, []);
  return null;
}
