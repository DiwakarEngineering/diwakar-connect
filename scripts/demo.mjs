// Starts Diwakar Connect in DEMO MODE: no Supabase project needed.
//
//   npm run demo        -> http://localhost:3000
//
// Demo mode runs a real PostgreSQL (PGlite) inside your browser with the same
// migrations, security policies and triggers as production, seeded from
// supabase/demo/seed.sql. Data stays in that browser only. Never deploy with
// NEXT_PUBLIC_DEMO_MODE=true.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const src = join(root, "node_modules", "@electric-sql", "pglite", "dist");
const dest = join(root, "public", "pglite");

if (!existsSync(src)) {
  console.error("PGlite isn't installed. Run `npm install` first.");
  process.exit(1);
}

// Copy the browser build (skipping source maps and CommonJS) so it is served locally.
function copy(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const s = join(from, name);
    const d = join(to, name);
    if (statSync(s).isDirectory()) copy(s, d);
    else if (!/\.(map|cjs|d\.ts|d\.cts)$/.test(name)) cpSync(s, d);
  }
}
copy(src, dest);

const port = process.env.PORT || "3000";
const env = { ...process.env, NEXT_PUBLIC_DEMO_MODE: "true", NEXT_TELEMETRY_DISABLED: "1" };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(npx, args, { stdio: "inherit", shell: process.platform === "win32", env });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

// `npm run demo:serve` builds once and serves the optimized app (fast page loads);
// `npm run demo` runs the dev server (live reload while editing).
if (process.argv.includes("--prod")) {
  const built = await run(["next", "build"]);
  if (built !== 0) process.exit(built);
  process.exit(await run(["next", "start", "-p", port]));
} else {
  process.exit(await run(["next", "dev", "-p", port]));
}
