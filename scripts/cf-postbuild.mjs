// Runs after `npm run build` (npm "postbuild" hook).
//
// On Cloudflare Workers Builds this produces the OpenNext
// Worker bundle in .open-next/, which `wrangler deploy` needs. That lets the
// dashboard keep "npm run build" as its build command.
//
// It does nothing locally, on other CI, or when OpenNext itself is running
// `npm run build` (it sets NEXT_PRIVATE_STANDALONE), which prevents a loop.
import { execSync } from "node:child_process";

// Workers Builds sets WORKERS_CI and builds in /opt/buildhome; either is enough.
const onCloudflare = Boolean(process.env.WORKERS_CI) || process.cwd().startsWith("/opt/buildhome/");

if (onCloudflare && !process.env.NEXT_PRIVATE_STANDALONE) {
  console.log("\n[cf-postbuild] Cloudflare build detected: running `opennextjs-cloudflare build`\n");
  execSync("npx opennextjs-cloudflare build", { stdio: "inherit" });
}
