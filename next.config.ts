import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera/microphone/screen capture are needed for calls on this origin only.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
  // Browsers must use HTTPS for this site for 2 years (no downgrade to http).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Pages opened from this app (or that open it) can't script its window.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];
// The Content-Security-Policy is per request (it needs a nonce): see src/middleware.ts.

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
