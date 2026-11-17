"use client";

import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  align?: "start" | "end";
  triggerClassName?: string;
  panelClassName?: string;
};

/** Composer-style popover above its trigger: closes on outside click or Escape (focus returns to the trigger). */
export function Popover({ open, onOpenChange, label, trigger, children, disabled, align = "start", triggerClassName, panelClassName }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    rootRef.current?.querySelector<HTMLElement>("[role=dialog] button, [role=dialog] input")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onOpenChange(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className={clsx(
            "absolute bottom-full z-50 mb-2 animate-fade-in rounded-xl border border-line bg-white shadow-pop",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
