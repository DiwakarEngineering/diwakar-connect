"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Mail, MapPin, MessageSquare, Phone, Video } from "lucide-react";
import type { RpcRow } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import { useToast } from "@/components/ui/toast";
import { Avatar, usePresenceState } from "@/components/ui/avatar";
import { PresenceIcon } from "@/components/ui/presence-badge";

type Directory = RpcRow<"search_directory">;
const cache = new Map<string, Directory | null>();

/** Department, contact details and role come from the directory (same visibility rules as the People page). */
async function loadDirectory(id: string, name: string): Promise<Directory | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  const { data } = await getSupabaseBrowserClient().rpc("search_directory", { p_query: name, p_limit: 25 });
  const row = (data ?? []).find((r) => r.id === id) ?? null;
  cache.set(id, row);
  return row;
}

/**
 * Profile card that opens from a person's picture: photo, presence, status
 * message, title and department, contact details, and Chat / Call buttons.
 */
export function ProfileCard({ userId, anchor, onClose }: { userId: string; anchor: DOMRect; onClose: () => void }) {
  const router = useRouter();
  const { session } = useSession();
  const { push } = useToast();
  const person = usePeopleById([userId]).get(userId);
  const presence = usePresenceState(userId, person?.availability);
  const [dir, setDir] = useState<Directory | null>(() => cache.get(userId) ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden", top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const isMe = userId === session.userId;

  useEffect(() => {
    if (!person) return;
    let live = true;
    void loadDirectory(userId, person.display_name).then((d) => live && setDir(d));
    return () => {
      live = false;
    };
  }, [person, userId]);

  // Beside the picture, flipped/clamped to stay on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const m = 8;
    let left = anchor.right + 8;
    if (left + w > window.innerWidth - m) left = Math.max(m, anchor.left - w - 8);
    if (left < m || window.innerWidth < 480) left = Math.max(m, Math.min(anchor.left, window.innerWidth - w - m));
    let top = anchor.top - 8;
    if (window.innerWidth < 480 || left === anchor.left) top = anchor.bottom + 8;
    top = Math.max(m, Math.min(top, window.innerHeight - h - m));
    setStyle({ top, left });
  }, [anchor, dir, person]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    ref.current?.focus({ preventScroll: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  async function open(target: "chat" | "audio" | "video") {
    setBusy(target);
    const { data, error } = await getSupabaseBrowserClient().rpc("get_or_create_direct_conversation", { p_other_user: userId });
    setBusy(null);
    if (error || !data) {
      push({ tone: "error", title: "Couldn't open a chat", description: friendlyError(error) });
      return;
    }
    onClose();
    router.push(target === "chat" ? `/chat/${data}` : `/call/${data}?media=${target}`);
  }

  const name = person?.display_name ?? dir?.display_name ?? "Colleague";
  const title = person?.title ?? dir?.title;
  const statusLine = presence.online ? presence.label : `Offline${person?.last_seen_at ? ` · last seen ${relativeTime(person.last_seen_at)}` : ""}`;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${name} profile`}
      tabIndex={-1}
      style={style}
      // React bubbles portal events to the opener (often inside a link): keep them here.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[55] w-[300px] max-w-[calc(100vw-16px)] animate-fade-in overflow-hidden rounded-2xl border border-line bg-white shadow-pop outline-none"
    >
      <div className="flex items-start gap-3 p-4">
        <Avatar name={name} path={person?.avatar_path} userId={userId} availability={person?.availability} showPresence size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-ink-900">{name}</div>
          {title ? <div className="truncate text-sm text-ink-600">{title}</div> : null}
          {dir?.department_name ? <div className="truncate text-xs text-ink-500">{dir.department_name}</div> : null}
        </div>
      </div>
      <div className="mx-4 flex items-center gap-2 rounded-xl bg-canvas px-3 py-2">
        <PresenceIcon kind={presence.kind} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{statusLine}</span>
      </div>
      {person?.status_message ? <p className="mx-4 mt-2 line-clamp-3 text-sm italic text-ink-600">&ldquo;{person.status_message}&rdquo;</p> : null}

      <dl className="space-y-1.5 px-4 py-3 text-sm">
        {dir?.email ? (
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Email</dt>
            <Mail className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <dd className="min-w-0 truncate">
              <a href={`mailto:${dir.email}`} className="text-brand-700 hover:underline">
                {dir.email}
              </a>
            </dd>
          </div>
        ) : null}
        {dir?.phone ? (
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Phone</dt>
            <Phone className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <dd>
              <a href={`tel:${dir.phone.replace(/[^\d+]/g, "")}`} className="text-brand-700 hover:underline">
                {dir.phone}
              </a>
            </dd>
          </div>
        ) : null}
        {dir?.work_location ? (
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Location</dt>
            <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <dd className="truncate text-ink-700">{dir.work_location}</dd>
          </div>
        ) : null}
        {dir?.role && dir.role !== "employee" ? (
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Role</dt>
            <Briefcase className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <dd className="capitalize text-ink-700">{dir.role}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex items-center gap-2 border-t border-line bg-canvas/60 px-4 py-3">
        {isMe ? (
          <Link href="/settings" onClick={onClose} className="inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700">
            Edit my profile
          </Link>
        ) : (
          <>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void open("chat")}
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" /> Chat
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void open("video")}
              aria-label={`Video call ${name}`}
              title="Video call"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-ink-700 hover:bg-ink-100 disabled:opacity-60"
            >
              <Video className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void open("audio")}
              aria-label={`Audio call ${name}`}
              title="Audio call"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-ink-700 hover:bg-ink-100 disabled:opacity-60"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
