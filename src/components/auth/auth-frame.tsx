import type { ReactNode } from "react";
import { MessagesSquare, ShieldCheck, Video } from "lucide-react";
import { BrandLockup, BrandMark } from "@/components/brand-mark";
import { COMPANY_NAME } from "@/lib/constants";

/** Two-panel layout for sign-in and account flows; collapses to one column on mobile. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#FFF4EA] via-[#FFF9F3] to-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden="true" className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-200/40 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-100/60 blur-3xl" />
        <div className="relative">
          <BrandLockup />
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-ink-900">
            One place for every conversation at {COMPANY_NAME}.
          </h2>
          <p className="mt-3 text-ink-600">
            Message colleagues, coordinate teams across sites, and jump on a call - securely, from the office or the field.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-ink-700">
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-600 shadow-card">
                <MessagesSquare className="h-4 w-4" aria-hidden="true" />
              </span>
              Direct, group and team channel conversations
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-600 shadow-card">
                <Video className="h-4 w-4" aria-hidden="true" />
              </span>
              Audio and video calls with screen sharing
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-600 shadow-card">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              Company-only access managed by your administrators
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-ink-500">© {new Date().getFullYear()} {COMPANY_NAME}</p>
      </aside>

      <main id="main" className="flex items-center justify-center bg-white px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <span className="text-base font-semibold text-ink-900">Diwakar Connect</span>
          </div>
          <h1 className="text-2xl font-semibold text-ink-900">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
