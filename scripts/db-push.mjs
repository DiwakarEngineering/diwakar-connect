// Applies supabase/migrations to the database in SUPABASE_DB_URL, recording
// each one in supabase_migrations.schema_migrations exactly like the Supabase
// CLI does, so `supabase db push` can take over later.
//
//   npm run db:push:staging            (reads .env.local)
//   npm run db:push:staging -- --dry   (list what would be applied)
//
// Guarded by E2E_CONFIRM_PROJECT_REF, which must match the project in the URL.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const DRY = process.argv.includes("--dry");
const dbUrl = process.env.SUPABASE_DB_URL;
const ref = process.env.E2E_CONFIRM_PROJECT_REF;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!dbUrl) fail("Set SUPABASE_DB_URL in .env.local (Supabase dashboard → Connect → Session pooler connection string).");
if (!ref || !dbUrl.includes(ref)) fail("Safety check: E2E_CONFIRM_PROJECT_REF must be set and match the project in SUPABASE_DB_URL.");

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

// Supabase serves TLS; verify against a CA file when provided (SUPABASE_DB_CA),
// otherwise encrypt without certificate pinning (acceptable for staging only).
const ssl = process.env.SUPABASE_DB_CA
  ? { ca: readFileSync(process.env.SUPABASE_DB_CA, "utf8") }
  : { rejectUnauthorized: false };

const client = new pg.Client({ connectionString: dbUrl, ssl });

try {
  await client.connect();
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    );
  `);
  const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
  const applied = new Set(rows.map((r) => r.version));

  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    if (applied.has(version)) {
      console.log(`  skip   ${file} (already applied)`);
      continue;
    }
    if (DRY) {
      console.log(`  would  ${file}`);
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)", [
        version,
        [sql],
        rest.join("_"),
      ]);
      await client.query("commit");
      console.log(`  apply  ${file}`);
    } catch (error) {
      await client.query("rollback");
      fail(`${file} failed and was rolled back: ${error.message}`);
    }
  }
  console.log(DRY ? "Dry run complete." : "Migrations are up to date.");
} catch (error) {
  fail(`Database connection failed: ${error.message}`);
} finally {
  await client.end().catch(() => undefined);
}
