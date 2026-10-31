// Runs after `npm run build` (npm "postbuild" hook).
//
// On Cloudflare Workers Builds (WORKERS_CI is set) this produces the OpenNext
// Worker bundle in .open-next/, which `wrangler deploy` needs. That lets the
// dashboard keep "npm run build" as its build command.
//
// It does nothing locally, on other CI, or when OpenNext itself is running
// `npm run build` (it sets NEXT_PRIVATE_STANDALONE), which prevents a loop.
import { execSync } from "node:child_process";

if (process.env.WORKERS_CI && !process.env.NEXT_PRIVATE_STANDALONE) {
  console.log("\n[cf-postbuild] Cloudflare build detected: running `opennextjs-cloudflare build`\n");
  execSync("npx opennextjs-cloudflare build", { stdio: "inherit" });
}
