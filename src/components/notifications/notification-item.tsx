"use client";

import Link from "next/link";
import clsx from "clsx";
import { AtSign, Bell, CornerUpLeft, Phone, Users } from "lucide-react";
import type { Tables } from "@/lib/database.types";
import { relativeTime } from "@/lib/format";

const ICONS = {
  mention: AtSign,
  reply: CornerUpLeft,
  team_invite: Users,
  call: Phone,
  system: Bell,
} as const;

export function notificationHref(n: Tables<"notifications">, channelHrefs: Map<string, string>): string {
  if (n.kind === "call" && n.conversation_id) return `/call/${n.conversation_id}`;
  if (n.kind === "team_invite" && n.team_id) return `/teams/${n.team_id}`;
  if (n.conversation_id) return channelHrefs.get(n.conversation_id) ?? `/chat/${n.conversation_id}`;
  return "/notifications";
}

export function NotificationItem({
  notification,
  href,
  onOpen,
  compact,
}: {
  notification: Tables<"notifications">;
  href: string;
  onOpen?: (n: Tables<"notifications">) => void;
  compact?: boolean;
}) {
  const Icon = ICONS[notification.kind];
  const unread = !notification.read_at;
  return (
    <Link
      href={href}
      onClick={() => onOpen?.(notification)}
      className={clsx("flex gap-3 px-4 py-3 transition-colors hover:bg-canvas", unread && "bg-brand-50/50")}
    >
      <span
        className={clsx(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          notification.kind === "call" ? "bg-success-50 text-success-700" : "bg-brand-50 text-brand-700",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx("block text-sm", unread ? "font-semibold text-ink-900" : "text-ink-800")}>{notification.title}</span>
        {notification.body && !compact ? <span className="mt-0.5 line-clamp-2 block text-sm text-ink-500">{notification.body}</span> : null}
        <time className="mt-0.5 block text-xs text-ink-400" dateTime={notification.created_at}>
          {relativeTime(notification.created_at)}
        </time>
      </span>
      {unread ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" /> : null}
    </Link>
  );
}
