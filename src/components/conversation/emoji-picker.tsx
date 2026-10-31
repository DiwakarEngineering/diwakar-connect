"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

const EMOJIS = [
  "👍", "👎", "❤️", "😂", "😊", "😍", "🙏", "👏",
  "🎉", "🔥", "✅", "❌", "👀", "🤔", "😅", "😢",
  "😮", "😎", "🙌", "💪", "🤝", "👋", "☀️", "⚡",
  "🔋", "🛠️", "📌", "📎", "📅", "⏰", "📈", "🚧",
  "🚚", "🏗️", "💡", "⚠️", "💯", "⭐", "🙂", "😴",
];

type Props = {
  label: string;
  trigger: ReactNode;
  onPick: (emoji: string) => void;
  align?: "start" | "end";
  triggerClassName?: string;
};

/** Small emoji grid in a popover; arrow keys move between emoji. */
export function EmojiPicker({ label, trigger, onPick, align = "end", triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    rootRef.current?.querySelector<HTMLButtonElement>("[data-emoji]")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-emoji]") ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
    };
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowRight") move(i + 1);
    else if (e.key === "ArrowLeft") move(i - 1);
    else if (e.key === "ArrowDown") move(i + 8);
    else if (e.key === "ArrowUp") move(i - 8);
  }

  return (
    <div ref={rootRef} className="relative inline-flex" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className={clsx(
            "absolute bottom-full z-50 mb-2 grid w-[296px] animate-fade-in grid-cols-8 gap-0.5 rounded-xl border border-line bg-white p-2 shadow-pop",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              data-emoji
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-ink-100 focus:bg-brand-50"
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
