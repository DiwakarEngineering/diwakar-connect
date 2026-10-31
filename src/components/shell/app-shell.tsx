"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Settings } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { CountBadge } from "@/components/ui/badge";
import { useSession } from "@/components/providers/session-provider";
import { useActivity } from "@/components/providers/activity-provider";
import { COMPANY_NAME } from "@/lib/constants";
import { isDemoMode } from "@/lib/env";
import { NAV_ITEMS, isActive, type NavItem } from "./nav-items";
import { TopBar } from "./top-bar";
import { MobileHeader } from "./mobile-header";

function useBadge(item: NavItem) {
  const { unreadChats, unreadChannels, unreadNotifications } = useActivity();
  if (item.badge === "chats") return unreadChats;
  if (item.badge === "channels") return unreadChannels;
  if (item.badge === "notifications") return unreadNotifications;
  return 0;
}

function SideNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const count = useBadge(item);
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        "lg:flex-row md:flex-col md:gap-1 md:px-1 md:py-2 md:text-[11px] lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm",
        active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
      )}
    >
      {active ? <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 hidden w-1 rounded-r bg-brand-500 lg:block" /> : null}
      <span className="relative">
        <Icon className="h-5 w-5" aria-hidden="true" />
        {count > 0 ? (
          <span className="absolute -right-2.5 -top-2 lg:hidden">
            <CountBadge count={count} label={`${count} unread`} />
          </span>
        ) : null}
      </span>
      <span className="lg:flex-1">{item.label}</span>
      {count > 0 ? (
        <span className="hidden lg:inline-flex">
          <CountBadge count={count} label={`${count} unread`} />
        </span>
      ) : null}
    </Link>
  );
}

function MobileNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const count = useBadge(item);
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
        active ? "text-brand-700" : "text-ink-500",
      )}
    >
      <span className="relative">
        <Icon className="h-[22px] w-[22px]" aria-hidden="true" strokeWidth={active ? 2.25 : 1.9} />
        {count > 0 ? (
          <span className="absolute -right-3 -top-1.5">
            <CountBadge count={count} label={`${count} unread`} />
          </span>
        ) : null}
      </span>
      {item.label}
    </Link>
  );
}

/**
 * Desktop: sidebar (full on lg, compact rail on md) + top bar.
 * Mobile: compact header + bottom navigation.
 * Full-screen routes (calls) render without chrome.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAdmin } = useSession();
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);

  if (pathname.startsWith("/call/")) {
    return <div className="min-h-dvh bg-ink-950">{children}</div>;
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <aside className="hidden w-[84px] shrink-0 flex-col border-r border-line bg-white md:flex lg:w-[244px]">
        <div className="flex h-16 items-center gap-2.5 px-4 lg:px-5">
          <BrandMark className="h-9 w-9" />
          <div className="hidden leading-tight lg:block">
            <div className="text-[15px] font-semibold text-ink-900">Diwakar Connect</div>
            <div className="text-xs text-ink-500">{COMPANY_NAME}</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-2 py-3 lg:px-3">
          {items.map((item) => (
            <SideNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <div className="border-t border-line px-2 py-3 lg:px-3">
          <SideNavLink item={{ href: "/settings", label: "Settings", icon: Settings }} pathname={pathname} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {isDemoMode() ? (
          <div role="note" className="shrink-0 bg-brand-600 px-4 py-1 text-center text-xs font-medium text-white">
            Local preview - data is stored only in this browser. Calls are unavailable.
          </div>
        ) : null}
        <TopBar />
        <MobileHeader />
        <main id="main" className="min-h-0 flex-1 overflow-hidden">
          {children}
        </main>
        <nav
          aria-label="Main"
          className="pb-safe flex shrink-0 border-t border-line bg-white md:hidden"
        >
          {items
            .filter((i) => i.mobile)
            .map((item) => (
              <MobileNavLink key={item.href} item={item} pathname={pathname} />
            ))}
        </nav>
      </div>
    </div>
  );
}
