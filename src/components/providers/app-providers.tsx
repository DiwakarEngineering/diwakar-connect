"use client";

import type { ReactNode } from "react";
import type { SessionInfo } from "@/lib/session";
import { SessionProvider } from "./session-provider";
import { PeopleProvider } from "./people-provider";
import { PresenceProvider } from "./presence-provider";
import { ActivityProvider } from "./activity-provider";
import { AppShell } from "@/components/shell/app-shell";

/** Everything a signed-in page needs: session, people cache, presence, activity and the shell. */
export function AppProviders({ session, children }: { session: SessionInfo; children: ReactNode }) {
  return (
    <SessionProvider initial={session}>
      <PeopleProvider seed={session.profile}>
        <PresenceProvider userId={session.userId}>
          <ActivityProvider userId={session.userId}>
            <AppShell>{children}</AppShell>
          </ActivityProvider>
        </PresenceProvider>
      </PeopleProvider>
    </SessionProvider>
  );
}
