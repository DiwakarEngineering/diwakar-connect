"use client";

import type { ReactNode } from "react";
import { useSession } from "@/components/providers/session-provider";

/** Demo-mode admin gate (data access is still enforced by RLS in the database). */
export function ClientAdminGate({ denied, children }: { denied: ReactNode; children: ReactNode }) {
  const { isAdmin } = useSession();
  return <>{isAdmin ? children : denied}</>;
}
