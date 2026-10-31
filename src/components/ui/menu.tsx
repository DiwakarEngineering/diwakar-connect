"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";

export type MenuItem =
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
    }
  | { type: "separator" }
  | { type: "label"; label: string };

type MenuProps = {
  /** Accessible name for the trigger button. */
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  side?: "bottom" | "top";
  triggerClassName?: string;
  menuClassName?: string;
};

/** Accessible dropdown menu (menu button pattern with arrow-key navigation). */
export function Menu({ label, trigger, items, align = "end", side = "bottom", triggerClassName, menuClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const menuId = useId();

  // The menu is position: fixed so cards with overflow-hidden can't clip it.
  // It opens on the preferred side and flips when there isn't room there.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const place = () => {
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;
      const r = button.getBoundingClientRect();
      const gap = 4;
      const margin = 8;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const h = Math.min(menu.scrollHeight, vh - margin * 2);
      const w = menu.offsetWidth;
      const roomBelow = vh - r.bottom - gap - margin;
      const roomAbove = r.top - gap - margin;
      const up = side === "top" ? roomAbove >= h || roomAbove > roomBelow : roomBelow < h && roomAbove > roomBelow;
      const top = up ? Math.max(margin, r.top - gap - h) : Math.min(r.bottom + gap, vh - margin - h);
      const preferredLeft = align === "end" ? r.right - w : r.left;
      const left = Math.min(Math.max(margin, preferredLeft), vw - margin - w);
      setPlacement({ top, left, maxHeight: vh - margin * 2 });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [align, open, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus the first item once the menu is placed (hidden elements can't take focus).
  const placed = placement !== null;
  useEffect(() => {
    if (!placed) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [placed]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const itemsEls = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const index = itemsEls.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      itemsEls[(index + 1) % itemsEls.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemsEls[(index - 1 + itemsEls.length) % itemsEls.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={placement ?? { top: 0, left: 0, visibility: "hidden" }}
          className={clsx(
            "fixed z-50 min-w-48 animate-fade-in overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-pop",
            menuClassName,
          )}
        >
          {items.map((item, i) => {
            if (item.type === "separator") return <div key={i} role="separator" className="my-1 h-px bg-line" />;
            if (item.type === "label")
              return (
                <div key={i} className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {item.label}
                </div>
              );
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                  item.onSelect();
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm disabled:opacity-50",
                  item.danger ? "text-danger-600 hover:bg-danger-50 focus:bg-danger-50" : "text-ink-800 hover:bg-ink-100 focus:bg-ink-100",
                )}
              >
                {item.icon ? <span className="text-ink-500">{item.icon}</span> : null}
                <span className="flex-1">{item.label}</span>
                {item.hint ? <span className="text-xs text-ink-400">{item.hint}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
