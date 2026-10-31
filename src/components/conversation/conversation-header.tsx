"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, BellOff, Eraser, Hash, Lock, MoreVertical, Phone, Pin, PinOff, Search, Users, Video, Bell, Pencil, Settings2 } from "lucide-react";
import type { Person } from "@/components/providers/people-provider";
import { Avatar, usePresenceState } from "@/components/ui/avatar";
import { Menu, type MenuItem } from "@/components/ui/menu";
import type { ConversationMeta } from "./types";

type Props = {
  meta: ConversationMeta;
  other: Person | undefined;
  backHref: string;
  activePanel: string | null;
  callsAvailable: boolean;
  activeCall: boolean;
  onTogglePanel: (panel: "members" | "search") => void;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onRename: () => void;
  onClearHistory: () => void;
};

export function ConversationHeader({
  meta,
  other,
  backHref,
  activePanel,
  callsAvailable,
  activeCall,
  onTogglePanel,
  onTogglePin,
  onToggleMute,
  onRename,
  onClearHistory,
}: Props) {
  const presence = usePresenceState(other?.id, other?.availability);
  const router = useRouter();

  let subtitle: string;
  if (meta.kind === "direct") {
    subtitle = other?.status_message ? `${presence.label} · ${other.status_message}` : presence.label;
  } else if (meta.kind === "group") {
    subtitle = `${meta.memberIds.length} members`;
  } else {
    subtitle = [meta.team?.name, meta.channel?.description].filter(Boolean).join(" · ");
  }

  const menu: MenuItem[] = [
    meta.isPinned
      ? { label: "Unpin", icon: <PinOff className="h-4 w-4" />, onSelect: onTogglePin }
      : { label: "Pin to top", icon: <Pin className="h-4 w-4" />, onSelect: onTogglePin },
    meta.isMuted
      ? { label: "Unmute", icon: <Bell className="h-4 w-4" />, onSelect: onToggleMute }
      : { label: "Mute", icon: <BellOff className="h-4 w-4" />, onSelect: onToggleMute },
  ];
  if (meta.kind === "group") menu.push({ label: "Rename group", icon: <Pencil className="h-4 w-4" />, onSelect: onRename });
  if (meta.kind === "channel" && meta.team && meta.canManage) {
    const teamId = meta.team.id;
    menu.push({ label: "Manage team & channels", icon: <Settings2 className="h-4 w-4" />, onSelect: () => router.push(`/teams/${teamId}`) });
  }
  menu.push({ label: "Clear chat history", icon: <Eraser className="h-4 w-4" />, onSelect: onClearHistory });

  const callHref = (media: "audio" | "video") => `/call/${meta.id}?media=${media}`;
  const callDisabled = !meta.canPost || !callsAvailable;
  const iconBtn = "flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100 hover:text-ink-900";

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white px-3 md:px-5">
      <Link href={backHref} className={clsx(iconBtn, "md:hidden")} aria-label="Back">
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Link>
      {meta.kind === "direct" && other ? (
        <Avatar name={other.display_name} path={other.avatar_path} userId={other.id} availability={other.availability} showPresence size="md" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          {meta.kind === "channel" ? (
            meta.channel?.visibility === "private" ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Hash className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Users className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold text-ink-900">{meta.title}</h1>
        {subtitle ? <p className="truncate text-xs text-ink-500">{subtitle}</p> : null}
      </div>

      <div className="flex items-center gap-0.5">
        {activeCall ? (
          <Link
            href={callHref("video")}
            className="mr-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-success-600 px-3 text-sm font-semibold text-white hover:bg-success-700"
          >
            <Video className="h-4 w-4" aria-hidden="true" />
            Join call
          </Link>
        ) : callDisabled ? (
          <>
            <span className={clsx(iconBtn, "cursor-not-allowed opacity-40")} title={callsAvailable ? "You can't call here" : "Calling isn't set up yet"}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Audio call unavailable</span>
            </span>
            <span className={clsx(iconBtn, "cursor-not-allowed opacity-40")} title={callsAvailable ? "You can't call here" : "Calling isn't set up yet"}>
              <Video className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Video call unavailable</span>
            </span>
          </>
        ) : (
          <>
            <Link href={callHref("audio")} className={iconBtn} aria-label="Start audio call">
              <Phone className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href={callHref("video")} className={iconBtn} aria-label="Start video call">
              <Video className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        )}
        <button
          type="button"
          onClick={() => onTogglePanel("search")}
          className={clsx(iconBtn, activePanel === "search" && "bg-brand-50 text-brand-700")}
          aria-label="Search in conversation"
          aria-pressed={activePanel === "search"}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
        {meta.kind !== "direct" ? (
          <button
            type="button"
            onClick={() => onTogglePanel("members")}
            className={clsx(iconBtn, activePanel === "members" && "bg-brand-50 text-brand-700")}
            aria-label="Show members"
            aria-pressed={activePanel === "members"}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <Menu label="Conversation options" items={menu} trigger={<MoreVertical className="h-4 w-4" aria-hidden="true" />} triggerClassName={iconBtn} />
      </div>
    </header>
  );
}
