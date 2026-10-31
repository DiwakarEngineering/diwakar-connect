import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <BrandMark className="h-12 w-12" />
      <h1 className="mt-6 text-2xl font-semibold text-ink-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500">The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
        Go to Diwakar Connect
      </Link>
    </main>
  );
}
