"use client";

import clsx from "clsx";
import type { Enums } from "@/lib/database.types";
import { AVAILABILITY } from "@/lib/constants";
import { initials } from "@/lib/format";
import { useSignedUrl } from "@/lib/storage";
import { usePresence } from "@/components/providers/presence-provider";

type Size = "xs" | "sm" | "md" | "lg" | "xl";
const SIZES: Record<Size, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-20 w-20 text-2xl",
};
const DOT: Record<Size, string> = {
  xs: "h-2 w-2",
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
  lg: "h-3.5 w-3.5",
  xl: "h-4 w-4",
};

// Warm, distinct backgrounds for initials so people are easy to tell apart.
const PALETTE = [
  "bg-brand-100 text-brand-800",
  "bg-[#E7EEFF] text-[#2B4C9B]",
  "bg-[#E6F6EE] text-[#1E6B47]",
  "bg-[#F3E8FF] text-[#6B3FA0]",
  "bg-[#FFF1D6] text-[#8A5A00]",
  "bg-[#E3F4F7] text-[#1F6474]",
];

function paletteFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export type PresenceState = { label: string; dotClass: string; online: boolean };

/** Combines the person's chosen availability with whether they're connected. */
export function usePresenceState(userId: string | undefined, availability: Enums<"availability"> | undefined): PresenceState {
  const { online } = usePresence();
  const isOnline = !!userId && online.has(userId);
  if (!availability || availability === "offline" || !isOnline) {
    return { label: "Offline", dotClass: "bg-white ring-2 ring-inset ring-ink-300", online: false };
  }
  return { label: AVAILABILITY[availability].label, dotClass: AVAILABILITY[availability].dot, online: true };
}

type AvatarProps = {
  name: string;
  path?: string | null;
  userId?: string;
  availability?: Enums<"availability">;
  showPresence?: boolean;
  size?: Size;
  className?: string;
  square?: boolean;
};

export function Avatar({ name, path, userId, availability, showPresence = false, size = "md", className, square }: AvatarProps) {
  const url = useSignedUrl("avatars", path, 3600);
  const presence = usePresenceState(userId, availability);

  return (
    <span className={clsx("relative inline-flex shrink-0", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived and not optimizable
        <img
          src={url}
          alt=""
          className={clsx(SIZES[size], square ? "rounded-xl" : "rounded-full", "object-cover ring-1 ring-black/5")}
        />
      ) : (
        <span
          aria-hidden="true"
          className={clsx(
            SIZES[size],
            square ? "rounded-xl" : "rounded-full",
            "inline-flex items-center justify-center font-semibold",
            paletteFor(userId ?? name),
          )}
        >
          {initials(name)}
        </span>
      )}
      {showPresence ? (
        <span
          className={clsx("absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white", DOT[size], presence.dotClass)}
          title={presence.label}
        >
          <span className="sr-only">{presence.label}</span>
        </span>
      ) : null}
    </span>
  );
}
