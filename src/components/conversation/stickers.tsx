"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  Coffee,
  HardHat,
  Heart,
  PartyPopper,
  Rocket,
  Sticker as StickerIcon,
  Sun,
  ThumbsUp,
  Trophy,
  CircleCheckBig,
  Zap,
  Handshake,
  type LucideIcon,
} from "lucide-react";
import { Popover } from "./popover";

/**
 * Built-in Diwakar Connect sticker set. A message stores only the sticker id
 * (validated by the database: lowercase letters, digits and dashes).
 */
export const STICKERS: { id: string; label: string; icon: LucideIcon; tone: "orange" | "navy" | "green" | "gold" }[] = [
  { id: "thumbs-up", label: "Thumbs up", icon: ThumbsUp, tone: "orange" },
  { id: "thank-you", label: "Thank you", icon: Heart, tone: "orange" },
  { id: "great-work", label: "Great work", icon: Trophy, tone: "gold" },
  { id: "done", label: "Done", icon: CircleCheckBig, tone: "green" },
  { id: "on-site", label: "On site", icon: HardHat, tone: "gold" },
  { id: "solar-power", label: "Solar power", icon: Sun, tone: "orange" },
  { id: "charged-up", label: "Charged up", icon: Zap, tone: "gold" },
  { id: "celebrate", label: "Celebrate", icon: PartyPopper, tone: "orange" },
  { id: "lets-go", label: "Let's go", icon: Rocket, tone: "navy" },
  { id: "deal", label: "Deal", icon: Handshake, tone: "navy" },
  { id: "coffee-break", label: "Coffee break", icon: Coffee, tone: "navy" },
];

const TONES = {
  orange: "from-brand-400 to-brand-600 text-white",
  navy: "from-[#33416B] to-[#1B2440] text-white",
  green: "from-success-600 to-success-700 text-white",
  gold: "from-[#FCCB5A] to-[#F2A516] text-ink-900",
} as const;

export function stickerById(id: string | null | undefined) {
  return id ? STICKERS.find((s) => s.id === id) : undefined;
}

export function Sticker({ id, size = "lg" }: { id: string; size?: "sm" | "lg" }) {
  const sticker = stickerById(id);
  if (!sticker) {
    return <span className="text-sm italic text-ink-400">Sticker</span>;
  }
  const Icon = sticker.icon;
  return (
    <span
      role="img"
      aria-label={`Sticker: ${sticker.label}`}
      className={clsx(
        "inline-flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br shadow-card",
        TONES[sticker.tone],
        size === "lg" ? "h-28 w-28 gap-1.5 p-3" : "h-16 w-16 gap-0.5 p-1.5",
      )}
    >
      <Icon className={size === "lg" ? "h-10 w-10" : "h-6 w-6"} strokeWidth={2.2} aria-hidden="true" />
      <span className={clsx("text-center font-semibold leading-tight", size === "lg" ? "text-xs" : "text-[9px]")}>{sticker.label}</span>
    </span>
  );
}

/** Composer button that opens the sticker grid. */
export function StickerPicker({ onPick, disabled }: { onPick: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Stickers"
      disabled={disabled}
      trigger={<StickerIcon className="h-4 w-4" aria-hidden="true" />}
      triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:opacity-40"
      panelClassName="w-[19rem] p-3"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Stickers</p>
      <div className="grid grid-cols-4 gap-2">
        {STICKERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onPick(s.id);
              setOpen(false);
            }}
            className="rounded-xl p-0.5 transition-transform hover:scale-105 focus-visible:scale-105"
            aria-label={`Send ${s.label} sticker`}
          >
            <Sticker id={s.id} size="sm" />
          </button>
        ))}
      </div>
    </Popover>
  );
}
