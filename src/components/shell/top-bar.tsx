"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Bell, ChevronDown } from "lucide-react";
import { Avatar, usePresenceState } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/badge";
import { useSession } from "@/components/providers/session-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { usePresence } from "@/components/providers/presence-provider";
import { GlobalSearch } from "./global-search";
import { ProfilePanel } from "./profile-panel";

export function TopBar() {
  const { session } = useSession();
  const { unreadNotifications } = useActivity();
  const { connected } = usePresence();
  const presence = usePresenceState(session.userId, session.profile.availability);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="hidden h-16 shrink-0 items-center gap-4 border-b border-line bg-white px-5 md:flex">
      <div className="w-full max-w-xl">
        <GlobalSearch />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {!connected ? (
          <span className="hidden items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-700 lg:inline-flex" role="status">
            <span className="h-1.5 w-1.5 rounded-full bg-warning-600" aria-hidden="true" />
            Reconnecting
          </span>
        ) : null}
        <Link
          href="/notifications"
          className="relative flex h-10 w-10 items-center justify-center rounded-xl text-ink-600 hover:bg-ink-100 hover:text-ink-900"
          aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : "Notifications"}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadNotifications > 0 ? (
            <span className="absolute right-1 top-1">
              <CountBadge count={unreadNotifications} />
            </span>
          ) : null}
        </Link>
        <div ref={rootRef} className="relative">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 hover:bg-ink-100"
          >
            <Avatar
              name={session.profile.display_name}
              path={session.profile.avatar_path}
              userId={session.userId}
              availability={session.profile.availability}
              showPresence
              size="sm"
            />
            <span className="hidden text-left leading-tight lg:block">
              <span className="block max-w-[160px] truncate text-sm font-medium text-ink-900">{session.profile.display_name}</span>
              <span className="block text-xs text-ink-500">{presence.online ? presence.label : "Offline"}</span>
            </span>
            <ChevronDown className={clsx("h-4 w-4 text-ink-400 transition-transform", open && "rotate-180")} aria-hidden="true" />
            <span className="sr-only">Open profile and status menu</span>
          </button>
          {open ? (
            <div
              role="dialog"
              aria-label="Profile and status"
              className="absolute right-0 top-full z-50 mt-2 w-80 animate-fade-in overflow-hidden rounded-2xl border border-line bg-white shadow-pop"
            >
              <ProfilePanel onNavigate={() => setOpen(false)} />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
