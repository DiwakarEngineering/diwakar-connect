"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; title: string; description?: string; action?: { label: string; onClick: () => void } };
type ToastInput = Omit<Toast, "id"> & { durationMs?: number };

const ToastContext = createContext<{ push: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    ({ durationMs, ...toast }: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), durationMs ?? (toast.tone === "error" ? 7000 : 4000));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl border border-line bg-white p-3 shadow-pop"
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" aria-hidden="true" />
            ) : t.tone === "error" ? (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-sm text-ink-500">{t.description}</p> : null}
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className={clsx("mt-2 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700")}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 text-ink-400 hover:text-ink-700"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
