import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Diwakar Connect", template: "%s · Diwakar Connect" },
  description: "Chat, teams and calls for Diwakar Solar employees.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#F06A1A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        <a
          href="#main"
          className="sr-only z-[100] rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink-900 shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to main content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
