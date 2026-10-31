import clsx from "clsx";
import { APP_NAME, COMPANY_NAME } from "@/lib/constants";

/**
 * Original Diwakar Connect mark: a rising sun inside a speech bubble.
 * Decorative unless a title is given.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={clsx("h-9 w-9", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d="M8 4h24a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H17l-7.2 5.6c-.7.5-1.8 0-1.8-.9V32a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6Z" fill="#F06A1A" />
      <path d="M12 25a8 8 0 0 1 16 0Z" fill="#fff" />
      <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
        <path d="M20 10.5v2.6" />
        <path d="M11.2 14.2l1.9 1.8" />
        <path d="M28.8 14.2l-1.9 1.8" />
        <path d="M8.5 22h2.2" />
        <path d="M29.3 22h2.2" />
      </g>
      <path d="M9.5 27.5h21" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".9" />
    </svg>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {!compact ? (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-ink-900">{APP_NAME}</div>
          <div className="text-xs text-ink-500">{COMPANY_NAME}</div>
        </div>
      ) : null}
    </div>
  );
}
