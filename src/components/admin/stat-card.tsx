import type { ReactNode } from "react";

export function StatCard({ label, value, icon, hint }: { label: string; value: ReactNode; icon: ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between rounded-2xl border border-line bg-white p-4 shadow-card">
      <div>
        <div className="text-sm text-ink-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-ink-900">{value}</div>
        {hint ? <div className="mt-0.5 text-xs text-ink-400">{hint}</div> : null}
      </div>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600" aria-hidden="true">
        {icon}
      </span>
    </div>
  );
}
