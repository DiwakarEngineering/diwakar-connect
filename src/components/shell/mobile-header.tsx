"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { CountBadge } from "@/components/ui/badge";
import { useSession } from "@/components/providers/session-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { GlobalSearch } from "./global-search";
import { ProfilePanel } from "./profile-panel";

const TITLES: [string, string][] = [
  ["/chat", "Chat"],
  ["/teams", "Teams"],
  ["/calls", "Calls"],
  ["/people", "People"],
  ["/notifications", "Notifications"],
  ["/settings", "Settings"],
  ["/admin", "Admin"],
];

/** Compact mobile header: profile drawer, section title, search and notifications. */
export function MobileHeader() {
  const pathname = usePathname();
  const { session } = useSession();
  const { unreadNotifications } = useActivity();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);

  const title = TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Home";

  // Conversation screens have their own header on mobile.
  const hidden = /^\/chat\/[^/]+/.test(pathname) || /^\/teams\/[^/]+\/[^/]+/.test(pathname);

  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    if (drawerOpen && !el.open) el.showModal();
    if (!drawerOpen && el.open) el.close();
  }, [drawerOpen]);

  useEffect(() => {
    setDrawerOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  if (hidden) return null;

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-3 md:hidden">
        {searchOpen ? (
          <>
            <div className="flex-1">
              <GlobalSearch autoFocus onDone={() => setSearchOpen(false)} />
            </div>
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-600"
              aria-label="Close search"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open profile and status" className="rounded-full">
              <Avatar
                name={session.profile.display_name}
                path={session.profile.avatar_path}
                userId={session.userId}
                availability={session.profile.availability}
                showPresence
                size="sm"
              />
            </button>
            <h1 className="flex-1 text-lg font-semibold text-ink-900">{title}</h1>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-600 hover:bg-ink-100"
              aria-label="Search"
            >
              <Search className="h-5 w-5" aria-hidden="true" />
            </button>
            <Link
              href="/notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-xl text-ink-600 hover:bg-ink-100"
              aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : "Notifications"}
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadNotifications > 0 ? (
                <span className="absolute right-0.5 top-0.5">
                  <CountBadge count={unreadNotifications} />
                </span>
              ) : null}
            </Link>
          </>
        )}
      </header>

      <dialog
        ref={drawerRef}
        aria-label="Profile and status"
        onClose={() => setDrawerOpen(false)}
        onClick={(e) => {
          if (e.target === drawerRef.current) setDrawerOpen(false);
        }}
        className="m-0 h-dvh max-h-dvh w-[85vw] max-w-sm bg-white p-0 shadow-pop backdrop:bg-ink-950/40 open:animate-fade-in"
      >
        {drawerOpen ? (
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="flex justify-end px-2 pt-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-500 hover:bg-ink-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <ProfilePanel onNavigate={() => setDrawerOpen(false)} />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
