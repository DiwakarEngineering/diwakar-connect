// Cloudflare (OpenNext) adapter config. The app is almost entirely dynamic,
// so no incremental cache (R2/KV) is configured.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
