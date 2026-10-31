"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/** Last-resort boundary. Shows a generic message; never the stack trace. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest lets operators correlate with server logs without exposing details.
    console.error("ui.unhandled_error", { digest: error.digest });
  }, [error.digest]);

  return (
    <main id="main" className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-ink-900">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-500">
        Please try again. If it keeps happening, contact your administrator{error.digest ? ` and mention code ${error.digest}` : ""}.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
      >
        Try again
      </button>
    </main>
  );
}
