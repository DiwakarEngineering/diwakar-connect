import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, Lock } from "lucide-react";
import { Spinner } from "./spinner";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">{icon}</div>
      ) : null}
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={clsx("flex flex-col items-center px-6 py-10 text-center", className)}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="max-w-sm text-sm text-ink-700">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink-800 hover:bg-canvas"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function PermissionDenied({ message = "You don't have access to this page." }: { message?: string }) {
  return (
    <EmptyState
      icon={<Lock className="h-5 w-5" aria-hidden="true" />}
      title="Access restricted"
      description={message}
    />
  );
}

export function LoadingState({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center justify-center gap-2 py-10 text-sm text-ink-500", className)}>
      <Spinner className="h-4 w-4" label="" />
      <span role="status">{label}...</span>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-full bg-ink-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-ink-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-ink-100/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
