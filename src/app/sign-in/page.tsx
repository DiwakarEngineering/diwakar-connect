import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-frame";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  expired: "Your session has expired. Please sign in again.",
  link: "That sign-in link is invalid or has expired. Ask for a new one.",
  disabled: "Your account is not active. Contact your administrator.",
  reset: "Your password was updated. Sign in with your new password.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string; next?: string }> }) {
  const { reason, next } = await searchParams;
  return (
    <AuthFrame title="Sign in" subtitle="Use your Diwakar Solar work account.">
      <SignInForm notice={reason ? (REASONS[reason] ?? null) : null} next={next ?? null} />
    </AuthFrame>
  );
}
