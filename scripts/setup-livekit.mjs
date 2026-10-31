// Interactive helper that adds the call settings to .env.local.
//
//   npm run setup:livekit
//
// Asks for the LiveKit URL, API key and API secret, plus the Supabase secret
// key if it is still missing (the call endpoints need it). Values already
// filled in are kept. Secrets are not shown on screen. Nothing is sent
// anywhere; the file is written only to this folder.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const file = join(process.cwd(), ".env.local");
const base = existsSync(file) ? readFileSync(file, "utf8") : readFileSync(join(process.cwd(), ".env.example"), "utf8");

const current = (key) => {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(base);
  const v = m?.[1]?.trim() ?? "";
  return !v || /your-|placeholder/i.test(v) ? "" : v;
};

function ask(question, { secret = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (secret) {
      // Hide what is typed or pasted.
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (s === "\r\n" || s === "\n") rl.output.write(s);
        else rl.output.write("*");
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (secret) process.stdout.write("\n");
      resolve(answer.trim().replace(/^["']|["']$/g, ""));
    });
  });
}

async function askValid(question, check, opts) {
  for (;;) {
    const value = await ask(question, opts);
    const problem = check(value);
    if (!problem) return value;
    console.log(`  ✖ ${problem} Please try again.\n`);
  }
}

async function value(key, label, question, check, opts) {
  const existing = current(key);
  if (existing) {
    console.log(`✔ ${label} already set`);
    return existing;
  }
  return askValid(question, check, opts);
}

console.log("\nDiwakar Connect - call settings (LiveKit)\n");
console.log("Find these in LiveKit Cloud: Settings -> API Keys (URL, API key, API secret).");
console.log("To paste here: click in this window, then right-click (or Ctrl+V), then press Enter.\n");

const values = {
  LIVEKIT_URL: await value("LIVEKIT_URL", "LiveKit URL", "LiveKit URL (wss://xxxx.livekit.cloud): ", (v) =>
    /^wss?:\/\/[^\s/]+\/?$/i.test(v) ? null : "It should look like wss://xxxx.livekit.cloud.",
  ),
  LIVEKIT_API_KEY: await value("LIVEKIT_API_KEY", "LiveKit API key", "LiveKit API key (starts with API): ", (v) =>
    v.length >= 8 && !/\s/.test(v) ? null : "Paste the API key shown next to the secret.",
  ),
  LIVEKIT_API_SECRET: await value(
    "LIVEKIT_API_SECRET",
    "LiveKit API secret",
    "LiveKit API secret - hidden: ",
    (v) => (v.length >= 20 && !/\s/.test(v) ? null : "Paste the full API secret."),
    { secret: true },
  ),
  SUPABASE_SERVICE_ROLE_KEY: await value(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Supabase secret key",
    "Supabase secret key (Project Settings -> API Keys, starts with sb_secret_) - hidden: ",
    (v) => (v.length > 30 && !/sb_publishable_/.test(v) ? null : "Paste the secret key, not the publishable one."),
    { secret: true },
  ),
};
values.LIVEKIT_URL = values.LIVEKIT_URL.replace(/\/$/, "");

let out = base;
for (const [key, v] of Object.entries(values)) {
  const line = new RegExp(`^${key}=.*$`, "m");
  out = line.test(out) ? out.replace(line, () => `${key}=${v}`) : `${out.trimEnd()}\n${key}=${v}\n`;
}
writeFileSync(file, out);
console.log("\n✔ Saved the call settings to .env.local. You can close this tab and tell Claude it's done.\n");
