"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Bell, Check, LogOut, MessageSquareText, Settings, ShieldCheck } from "lucide-react";
import type { Enums } from "@/lib/database.types";
import { AVAILABILITY, ROLE_LABEL } from "@/lib/constants";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";
import { usePeople } from "@/components/providers/people-provider";
import { StatusMessageDialog } from "./status-message-dialog";

const OPTIONS = Object.entries(AVAILABILITY) as [Enums<"availability">, (typeof AVAILABILITY)[Enums<"availability">]][];

export function useSetAvailability() {
  const { session, setProfile } = useSession();
  const { upsert } = usePeople();
  const { push } = useToast();
  return async (availability: Enums<"availability">) => {
    const previous = session.profile;
    setProfile({ ...previous, availability });
    const { data, error } = await getSupabaseBrowserClient()
      .from("profiles")
      .update({ availability })
      .eq("id", session.userId)
      .select("*")
      .single();
    if (error || !data) {
      setProfile(previous);
      push({ tone: "error", title: "Couldn't update your status", description: friendlyError(error) });
      return;
    }
    setProfile(data);
    upsert(data);
  };
}

/** Profile summary, availability picker and account links (desktop popover and mobile drawer). */
export function ProfilePanel({ onNavigate }: { onNavigate: () => void }) {
  const { session, isAdmin, signOut } = useSession();
  const setAvailability = useSetAvailability();
  const [statusOpen, setStatusOpen] = useState(false);
  const { profile } = session;

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 px-4 py-4">
        <Avatar name={profile.display_name} path={profile.avatar_path} userId={profile.id} availability={profile.availability} showPresence size="lg" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-900">{profile.display_name}</div>
          <div className="truncate text-xs text-ink-500">{profile.title ?? session.email}</div>
          {session.role !== "employee" ? (
            <Badge tone="brand" className="mt-1">
              {ROLE_LABEL[session.role]}
            </Badge>
          ) : null}
        </div>
      </div>

      <div role="radiogroup" aria-label="Availability" className="border-t border-line px-2 py-2">
        {OPTIONS.map(([value, meta]) => {
          const selected = profile.availability === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void setAvailability(value)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-ink-100",
                selected ? "font-medium text-ink-900" : "text-ink-700",
              )}
            >
              <span className={clsx("h-2.5 w-2.5 rounded-full", meta.dot)} aria-hidden="true" />
              <span className="flex-1">{meta.label}</span>
              {selected ? <Check className="h-4 w-4 text-brand-600" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <div className="border-t border-line px-2 py-2">
        <button
          type="button"
          onClick={() => setStatusOpen(true)}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-100"
        >
          <MessageSquareText className="h-4 w-4 text-ink-500" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{profile.status_message ? `"${profile.status_message}"` : "Set status message"}</span>
        </button>
        <Link
          href="/settings#notifications"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-ink-100"
        >
          <Bell className="h-4 w-4 text-ink-500" aria-hidden="true" />
          Notification settings
        </Link>
        <Link href="/settings" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-ink-100">
          <Settings className="h-4 w-4 text-ink-500" aria-hidden="true" />
          Profile & settings
        </Link>
        {isAdmin ? (
          <Link href="/admin" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-ink-100">
            <ShieldCheck className="h-4 w-4 text-ink-500" aria-hidden="true" />
            Admin console
          </Link>
        ) : null}
      </div>
      <div className="border-t border-line px-2 py-2">
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-100"
        >
          <LogOut className="h-4 w-4 text-ink-500" aria-hidden="true" />
          Sign out
        </button>
      </div>
      <StatusMessageDialog open={statusOpen} onClose={() => setStatusOpen(false)} />
    </div>
  );
}
