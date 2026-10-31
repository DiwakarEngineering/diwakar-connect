// Imports staff, departments, roles and department teams into the REAL
// Supabase project in .env.local (same rules as the local preview, from
// scripts/lib/employees.mjs).
//
//   npm run supabase:import -- "C:\path\to\employees.csv" --dry-run   (show the plan only)
//   npm run supabase:import -- "C:\path\to\employees.csv"
//   ... --reset-passwords   also reset passwords of people who already exist
//
// Safe to re-run: existing people, departments, teams and memberships are kept
// and updated, not duplicated. New accounts are created confirmed (no invite
// email) with the starting passwords; ask everyone to change theirs after the
// first sign-in. Requires the migrations to be applied (npm run db:push:staging).
// Refuses to run unless E2E_CONFIRM_PROJECT_REF matches the project URL.

import { createClient } from "@supabase/supabase-js";
import { COMPANY_TEAM, loadEmployees } from "./lib/employees.mjs";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry-run");
const RESET = args.includes("--reset-passwords");

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

if (!csvPath) fail('Usage: npm run supabase:import -- "path\\to\\employees.csv" [--dry-run] [--reset-passwords]');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || /your-/.test(url)) fail("Fill NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");
const ref = new URL(url).hostname.split(".")[0];
if (process.env.E2E_CONFIRM_PROJECT_REF !== ref) {
  fail(`Safety check: set E2E_CONFIRM_PROJECT_REF=${ref} in .env.local to confirm this is the project to import into.`);
}

const { people, skipped, departments, owner, teams } = loadEmployees(csvPath);
const nameOf = new Map(people.map((p) => [p.id, p.name]));
console.log(`Project ${ref}: ${people.length} people, ${departments.length} departments, ${teams.length + 1} teams${DRY ? " (dry run)" : ""}`);
if (skipped.length) console.log("Skipping:\n  " + skipped.join("\n  "));

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (res, what) => {
  if (res.error) fail(`${what}: ${res.error.message}`);
  return res.data;
};

// Preconditions -------------------------------------------------------------------
must(await db.from("organization_settings").select("id").eq("id", true).single(), "Migrations not applied (run npm run db:push:staging)");

// Existing auth users by email
const existing = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) fail(`Listing users: ${error.message}`);
  for (const u of data.users) if (u.email) existing.set(u.email.toLowerCase(), u.id);
  if (data.users.length < 1000) break;
}

const toCreate = people.filter((p) => !existing.has(p.email));
console.log(`Accounts: ${toCreate.length} to create, ${people.length - toCreate.length} already exist${RESET ? " (passwords will be reset)" : ""}.`);
if (DRY) {
  for (const t of [{ name: COMPANY_TEAM, ownerIds: [owner.id], memberIds: [] }, ...teams]) {
    console.log(`  team ${t.name}: owners ${t.ownerIds.map((id) => nameOf.get(id)).join(", ")}`);
  }
  console.log("\nDry run only - nothing was changed.");
  process.exit(0);
}

// Departments -----------------------------------------------------------------------
const deptRows = must(await db.from("departments").select("id, name"), "Reading departments");
const deptId = new Map(deptRows.map((d) => [d.name.toLowerCase(), d.id]));
const missingDepts = departments.filter((d) => !deptId.has(d.toLowerCase()));
if (missingDepts.length) {
  const added = must(await db.from("departments").insert(missingDepts.map((name) => ({ name }))).select("id, name"), "Creating departments");
  for (const d of added) deptId.set(d.name.toLowerCase(), d.id);
}

// People ----------------------------------------------------------------------------------
const realId = new Map(); // CSV-derived id -> Supabase auth user id
const problems = [];
for (const p of people) {
  let id = existing.get(p.email);
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({
      email: p.email,
      password: p.password,
      email_confirm: true,
      user_metadata: { display_name: p.name },
    });
    if (error || !data.user) {
      problems.push(`${p.name} <${p.email}>: ${error?.message ?? "not created"}`);
      continue;
    }
    id = data.user.id;
  } else if (RESET) {
    const { error } = await db.auth.admin.updateUserById(id, { password: p.password });
    if (error) problems.push(`${p.name}: password not reset (${error.message})`);
  }
  realId.set(p.id, id);

  const profile = await db
    .from("profiles")
    .update({
      display_name: p.name,
      title: p.title,
      department_id: p.dept ? (deptId.get(p.dept.toLowerCase()) ?? null) : null,
      employment_status: p.status,
    })
    .eq("id", id);
  if (profile.error) problems.push(`${p.name}: profile not updated (${profile.error.message})`);
  await db.from("profile_details").update({ phone: p.phone, work_location: p.location }).eq("user_id", id);
  await db.from("user_roles").update({ role: p.role }).eq("user_id", id);
  if (p.status !== "active") await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  process.stdout.write(".");
}
console.log(`\nPeople done: ${realId.size}/${people.length}.`);

// Teams ------------------------------------------------------------------------------------
const teamRows = must(await db.from("teams").select("id, name").is("archived_at", null), "Reading teams");
const teamId = new Map(teamRows.map((t) => [t.name.toLowerCase(), t.id]));
const allActive = people.filter((p) => p.status === "active").map((p) => p.id);
const plan = [
  {
    name: COMPANY_TEAM,
    description: "Company-wide announcements and discussion",
    visibility: "public",
    ownerIds: [owner.id],
    memberIds: allActive.filter((id) => id !== owner.id),
  },
  ...teams.map((t) => ({ ...t, description: `${t.name} department`, visibility: "private" })),
];

for (const t of plan) {
  const owners = t.ownerIds.map((id) => realId.get(id)).filter(Boolean);
  const members = t.memberIds.map((id) => realId.get(id)).filter(Boolean);
  if (owners.length === 0) {
    problems.push(`Team ${t.name}: no owner account available`);
    continue;
  }
  let id = teamId.get(t.name.toLowerCase());
  if (!id) {
    // The creator becomes the first owner and a General channel is added (database trigger).
    const created = await db
      .from("teams")
      .insert({ name: t.name, description: t.description, visibility: t.visibility, created_by: owners[0] })
      .select("id")
      .single();
    if (created.error) {
      problems.push(`Team ${t.name}: ${created.error.message}`);
      continue;
    }
    id = created.data.id;
  }
  const rows = [
    ...owners.map((user_id) => ({ team_id: id, user_id, role: "owner" })),
    ...members.map((user_id) => ({ team_id: id, user_id, role: "member" })),
  ];
  const added = await db.from("team_members").upsert(rows, { onConflict: "team_id,user_id", ignoreDuplicates: true });
  if (added.error) problems.push(`Team ${t.name} members: ${added.error.message}`);
  console.log(`  team ${t.name}: ${owners.length} owner(s), ${members.length} member(s)`);
}

await db.from("audit_logs").insert({
  action: "organization.staff_imported",
  target_type: "organization",
  metadata: { people: realId.size, departments: departments.length, teams: plan.length },
});

if (problems.length) {
  console.log(`\nFinished with ${problems.length} problem(s):\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log("\nImport complete. Everyone can sign in with their email and starting password.");
