import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand-mark";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  expired: "Your session has expired. Please sign in again.",
  link: "That sign-in link is invalid or has expired. Ask for a new one.",
  disabled: "Your account is not active. Contact your administrator.",
  reset: "Your password was updated. Sign in with your new password.",
};

/** Sign-in: the official Diwakar logo above a single, centred form. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next } = await searchParams;
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-[400px]">
        <BrandLogo className="h-12 w-auto sm:h-14" />
        <h1 className="mt-10 text-2xl font-semibold text-ink-900">Sign in</h1>
        <p className="mt-1.5 text-sm text-ink-500">Sign in with your company email.</p>
        <div className="mt-7">
          <SignInForm notice={reason ? (REASONS[reason] ?? null) : null} next={next ?? null} />
        </div>
      </div>
    </main>
  );
}
