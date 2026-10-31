import clsx from "clsx";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className="inline-flex items-center">
      <svg className={clsx("animate-spin text-current", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-90" d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
