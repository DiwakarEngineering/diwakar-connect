// Interactive helper that writes .env.local - paste each value when asked.
//
//   npm run setup:env
//
// Values already filled in .env.local are kept (it only asks for missing ones).
// Secret values are not shown on screen. Nothing is sent anywhere; the file is
// written only to this folder.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const file = join(process.cwd(), ".env.local");
const base = existsSync(file) ? readFileSync(file, "utf8") : readFileSync(join(process.cwd(), ".env.example"), "utf8");

const current = (key) => {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(base);
  const v = m?.[1]?.trim() ?? "";
  return !v || /your-|placeholder|\[YOUR-PASSWORD\]/i.test(v) ? "" : v;
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

console.log("\nDiwakar Connect - Supabase settings\n");
console.log("Find these in Supabase: the Connect button, and Project Settings -> API Keys.");
console.log("To paste here: click in this window, then right-click (or Ctrl+V), then press Enter.\n");

let url = current("NEXT_PUBLIC_SUPABASE_URL");
if (url) console.log(`✔ Project URL already set (${url})`);
else {
  url = await askValid("Project URL (https://xxxx.supabase.co): ", (v) =>
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(v) ? null : "That doesn't look like https://xxxx.supabase.co.",
  );
}
url = url.replace(/\/$/, "");
const ref = new URL(url).hostname.split(".")[0];

let anon = current("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (anon) console.log("✔ Publishable (anon) key already set");
else {
  anon = await askValid("Publishable key (starts with sb_publishable_, or the legacy anon key): ", (v) =>
    v.length > 30 && !/service_role|sb_secret_/i.test(v) ? null : "Paste the publishable / anon key, not the secret one.",
  );
}

let service = current("SUPABASE_SERVICE_ROLE_KEY");
if (service) console.log("✔ Secret key already set");
else {
  service = await askValid(
    "Secret key (starts with sb_secret_, or legacy service_role) - hidden: ",
    (v) => (v.length > 30 && v !== anon ? null : "Paste the secret key - it is different from the publishable key."),
    { secret: true },
  );
}

let dbUrl = current("SUPABASE_DB_URL");
if (dbUrl) console.log("✔ Database connection already set");
else {
  dbUrl = await askValid(
    "Session pooler connection string (paste it as shown, with [YOUR-PASSWORD]): ",
    (v) =>
      !/^postgres(ql)?:\/\//.test(v)
        ? "It should start with postgresql://"
        : !v.includes(ref)
          ? `This connection string isn't for project ${ref}.`
          : null,
  );
  if (dbUrl.includes("[YOUR-PASSWORD]")) {
    const password = await askValid("Database password (the one you set when creating the project) - hidden: ", (v) =>
      v ? null : "The password can't be empty.",
      { secret: true },
    );
    dbUrl = dbUrl.replace("[YOUR-PASSWORD]", encodeURIComponent(password));
  }
}

const values = {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
  SUPABASE_DB_URL: dbUrl,
  E2E_CONFIRM_PROJECT_REF: ref,
};

let out = base;
for (const [key, value] of Object.entries(values)) {
  const line = new RegExp(`^${key}=.*$`, "m");
  out = line.test(out) ? out.replace(line, () => `${key}=${value}`) : `${out.trimEnd()}\n${key}=${value}\n`;
}
writeFileSync(file, out);
console.log(`\n✔ Saved .env.local for project ${ref}. You can close this tab and tell Claude it's done.\n`);
