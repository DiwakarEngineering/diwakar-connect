import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Right-hand contextual panel; full-screen overlay on small screens. */
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside
      aria-label={title}
      className="fixed inset-0 z-40 flex flex-col bg-white lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:border-l lg:border-line"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          aria-label={`Close ${title.toLowerCase()}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
