"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { X } from "lucide-react";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Set while a request is in flight to stop accidental dismissal. */
  busy?: boolean;
};

const WIDTHS = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

/**
 * Modal built on the native <dialog> element: focus is trapped and restored by
 * the browser, Escape closes it, and the rest of the page becomes inert.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", busy = false }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!busy) onClose();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [busy, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself) closes it.
        if (event.target === ref.current && !busy) onClose();
      }}
      className={clsx(
        "w-[calc(100%-2rem)] rounded-2xl border border-line bg-white p-0 text-ink-900 shadow-pop backdrop:bg-ink-950/40",
        "open:animate-slide-up",
        WIDTHS[size],
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-ink-900">
                {title}
              </h2>
              {description ? (
                <div id={descId} className="mt-1 text-sm text-ink-500">
                  {description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="-mr-1 rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:opacity-50"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {children ? <div className="overflow-y-auto px-5 py-4">{children}</div> : null}
          {footer ? <div className="flex justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, tone = "danger", busy, onConfirm, onClose }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink-800 hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={clsx(
              "h-9 rounded-lg px-3 text-sm font-medium text-white disabled:opacity-60",
              tone === "danger" ? "bg-danger-600 hover:bg-danger-700" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </>
      }
    />
  );
}
