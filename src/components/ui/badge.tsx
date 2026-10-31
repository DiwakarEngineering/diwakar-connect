import clsx from "clsx";
import type { ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-700",
  info: "bg-[#EEF4FF] text-[#2B4C9B]",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function CountBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-none text-white"
      aria-label={label ?? `${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
