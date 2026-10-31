import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * DEMO MODE ONLY: the SQL the in-browser database is built from - Supabase
 * stand-ins, the real migrations, demo additions and seed data.
 * Returns 404 unless NEXT_PUBLIC_DEMO_MODE=true.
 */
export function GET() {
  if (!isDemoMode()) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }
  const root = join(process.cwd(), "supabase");
  const migrations = readdirSync(join(root, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(root, "migrations", f), "utf8"));
  const parts = [
    readFileSync(join(root, "demo", "stubs.sql"), "utf8"),
    ...migrations,
    readFileSync(join(root, "demo", "demo.sql"), "utf8"),
    readFileSync(join(root, "demo", "seed.sql"), "utf8"),
  ];
  const version = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12);
  return NextResponse.json({ version, parts }, { headers: { "Cache-Control": "no-store" } });
}
