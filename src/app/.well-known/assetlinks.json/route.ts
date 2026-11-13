import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Digital Asset Links: proves to Android that the Play Store app (a Trusted
 * Web Activity) and this website belong together, so the app opens full-screen
 * without a browser bar. Configure with two runtime variables:
 *   ANDROID_PACKAGE_NAME            e.g. com.diwakarsolar.connect
 *   ANDROID_SHA256_FINGERPRINTS     comma-separated SHA-256 signing fingerprints
 *                                   (upload key and Play App Signing key)
 */
export function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim() || "com.diwakarsolar.connect";
  const fingerprints = (process.env.ANDROID_SHA256_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  const body = fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
        },
      ]
    : [];
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
}
