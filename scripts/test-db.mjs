// Applies supabase/migrations to an in-process Postgres (PGlite) with minimal
// stand-ins for Supabase's auth, storage and realtime schemas, then exercises
// the Row Level Security rules as different employees.
//
//   npm run test:db
//
// This never connects to a real Supabase project.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");

const SUPABASE_STUBS = readFileSync(join(root, "supabase", "demo", "stubs.sql"), "utf8");

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectError(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (pattern && !pattern.test(message)) {
      throw new Error(`Expected error matching ${pattern}, got: ${message}`);
    }
    return;
  }
  throw new Error(`Expected an error${pattern ? ` matching ${pattern}` : ""}, but the statement succeeded`);
}

const db = new PGlite();

/** Run statements as an API user (role authenticated + JWT sub). */
async function as(userId, fn, extra = {}) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    if (extra.topic) await tx.query("select set_config('realtime.topic', $1, true)", [extra.topic]);
    await tx.exec(`set local role ${extra.role ?? "authenticated"}`);
    return fn({
      q: async (sql, params) => (await tx.query(sql, params)).rows,
      one: async (sql, params) => (await tx.query(sql, params)).rows[0],
    });
  });
}

const service = (fn) => as(null, fn, { role: "service_role" });
const rows = async (sql, params) => (await db.query(sql, params)).rows;

async function createAuthUser(email, displayName) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify({ display_name: displayName }),
  ]);
  return id;
}

async function main() {
  console.log("Applying Supabase stubs and migrations...");
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
      console.log(`  applied ${file}`);
    } catch (error) {
      console.error(`Migration ${file} failed: ${error.message}`);
      process.exit(1);
    }
  }

  // ----- People -----
  const owner = await createAuthUser("owner@diwakar.test", "Olivia Owner");
  const admin = await createAuthUser("admin@diwakar.test", "Arun Admin");
  const manager = await createAuthUser("manager@diwakar.test", "Meera Manager");
  const alice = await createAuthUser("alice@diwakar.test", "Alice Example");
  const bob = await createAuthUser("bob@diwakar.test", "Bob Example");
  const mallory = await createAuthUser("mallory@diwakar.test", "Mallory Outsider");
  const carl = await createAuthUser("carl@diwakar.test", "Carl Invited");
  const sue = await createAuthUser("sue@diwakar.test", "Sue Suspended");

  console.log("\nProvisioning and lifecycle");

  await check("new auth users get an invited profile, details, role and preferences", async () => {
    const [p] = await rows("select employment_status from public.profiles where id = $1", [alice]);
    assert(p.employment_status === "invited", `status was ${p.employment_status}`);
    const [d] = await rows("select email from public.profile_details where user_id = $1", [alice]);
    assert(d.email === "alice@diwakar.test", "email not copied");
    const [r] = await rows("select role from public.user_roles where user_id = $1", [alice]);
    assert(r.role === "employee", "default role should be employee");
  });

  await check("bootstrap_owner promotes the first owner and cannot run twice", async () => {
    await db.query("select public.bootstrap_owner('owner@diwakar.test')");
    const [r] = await rows("select role from public.user_roles where user_id = $1", [owner]);
    assert(r.role === "owner", "owner not set");
    await expectError(db.query("select public.bootstrap_owner('admin@diwakar.test')"), /owner already exists/);
  });

  await check("bootstrap_owner is not callable through the API", async () => {
    await expectError(as(alice, ({ q }) => q("select public.bootstrap_owner('alice@diwakar.test')")), /permission denied/);
  });

  // Server-side admin actions (service role) activate people and assign roles.
  await service(async ({ q }) => {
    await q(
      "update public.profiles set employment_status = 'active' where id = any($1::uuid[])",
      [[admin, manager, alice, bob, mallory, sue]],
    );
    await q("update public.user_roles set role = 'admin' where user_id = $1", [admin]);
    await q("update public.user_roles set role = 'manager' where user_id = $1", [manager]);
  });

  await check("invited person activates their own account", async () => {
    const r = await as(carl, ({ one }) => one("select public.activate_my_account() as s"));
    assert(r.s === "active", `got ${r.s}`);
  });

  await service(({ q }) => q("update public.profiles set employment_status = 'suspended' where id = $1", [sue]));

  await check("suspended person cannot re-activate themselves", async () => {
    const r = await as(sue, ({ one }) => one("select public.activate_my_account() as s"));
    assert(r.s === "suspended", `got ${r.s}`);
  });

  await check("suspended person sees only their own profile", async () => {
    const r = await as(sue, ({ q }) => q("select id from public.profiles"));
    assert(r.length === 1 && r[0].id === sue, `saw ${r.length} profiles`);
  });

  await check("anonymous role cannot read profiles", async () => {
    await expectError(as(null, ({ q }) => q("select * from public.profiles"), { role: "anon" }), /permission denied/);
  });

  await check("email domain allowlist blocks other domains in the database", async () => {
    await db.query("update public.organization_settings set allowed_email_domains = '{diwakar.test}'");
    await expectError(createAuthUser("stranger@gmail.com", "Stranger"), /not allowed/);
    await createAuthUser("dave@diwakar.test", "Dave Allowed");
    await db.query("update public.organization_settings set allowed_email_domains = '{}'");
  });

  console.log("\nProfiles and roles");

  await check("employees cannot change their own employment status", async () => {
    await expectError(
      as(alice, ({ q }) => q("update public.profiles set employment_status = 'deactivated' where id = $1", [alice])),
      /admin console/,
    );
  });

  await check("employees cannot change their own title", async () => {
    await expectError(
      as(alice, ({ q }) => q("update public.profiles set title = 'CEO' where id = $1", [alice])),
      /Only administrators/,
    );
  });

  await check("employees can update their own status message", async () => {
    await as(alice, ({ q }) =>
      q("update public.profiles set status_message = 'On site today', availability = 'busy' where id = $1", [alice]),
    );
    const [p] = await rows("select status_message from public.profiles where id = $1", [alice]);
    assert(p.status_message === "On site today", "not updated");
  });

  await check("employees cannot edit someone else's profile", async () => {
    const r = await as(mallory, ({ q }) =>
      q("update public.profiles set display_name = 'Hacked' where id = $1 returning id", [alice]),
    );
    assert(r.length === 0, "update should match no rows");
  });

  await check("admins can set another person's title but not their status message", async () => {
    await as(admin, ({ q }) => q("update public.profiles set title = 'Site Engineer' where id = $1", [alice]));
    await expectError(
      as(admin, ({ q }) => q("update public.profiles set status_message = 'x' where id = $1", [alice])),
      /Administrators can only edit/,
    );
  });

  await check("employees cannot write roles", async () => {
    const r = await as(alice, ({ q }) =>
      q("update public.user_roles set role = 'owner' where user_id = $1 returning user_id", [alice]),
    );
    assert(r.length === 0, "role update should be denied");
  });

  await check("contact details are private but the directory applies settings", async () => {
    await as(alice, ({ q }) => q("update public.profile_details set phone = '+91 98765 43210' where user_id = $1", [alice]));
    const direct = await as(bob, ({ q }) => q("select * from public.profile_details where user_id = $1", [alice]));
    assert(direct.length === 0, "bob should not read alice's details row");
    const [entry] = await as(bob, ({ q }) => q("select email, phone from public.search_directory('alice')"));
    assert(entry.email === "alice@diwakar.test", "email should be visible by default");
    assert(entry.phone === null, "phone should be hidden by default");
    const [adminView] = await as(admin, ({ q }) => q("select phone from public.search_directory('alice')"));
    assert(adminView.phone === "+91 98765 43210", "admin should see phone");
  });

  await check("directory hides suspended people from employees", async () => {
    const r = await as(bob, ({ q }) => q("select id from public.search_directory('sue')"));
    assert(r.length === 0, "sue should be hidden");
  });

  await check("admin_list_users requires admin", async () => {
    await expectError(as(alice, ({ q }) => q("select * from public.admin_list_users()")), /Administrator access/);
    const r = await as(admin, ({ q }) => q("select id, total_count from public.admin_list_users()"));
    assert(r.length >= 8, `admin saw ${r.length} users`);
  });

  console.log("\nDirect and group conversations");

  const dm = (await as(alice, ({ one }) => one("select public.get_or_create_direct_conversation($1) as id", [bob]))).id;

  await check("direct conversation is unique per pair", async () => {
    const again = await as(bob, ({ one }) => one("select public.get_or_create_direct_conversation($1) as id", [alice]));
    assert(again.id === dm, "a second DM was created");
  });

  await check("cannot start a chat with a suspended person", async () => {
    await expectError(
      as(alice, ({ q }) => q("select public.get_or_create_direct_conversation($1)", [sue])),
      /not available/,
    );
  });

  const msg1 = (
    await as(alice, ({ one }) =>
      one("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Hello Bob') returning id", [
        dm,
        alice,
      ]),
    )
  ).id;

  await check("members read messages; outsiders do not", async () => {
    const forBob = await as(bob, ({ q }) => q("select id from public.messages where conversation_id = $1", [dm]));
    assert(forBob.length === 1, `bob saw ${forBob.length}`);
    const forMallory = await as(mallory, ({ q }) => q("select id from public.messages where conversation_id = $1", [dm]));
    assert(forMallory.length === 0, "mallory should see nothing");
  });

  await check("outsiders cannot post into a conversation", async () => {
    await expectError(
      as(mallory, ({ q }) =>
        q("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hi')", [dm, mallory]),
      ),
      /row-level security/,
    );
  });

  await check("members cannot impersonate another sender", async () => {
    await expectError(
      as(bob, ({ q }) =>
        q("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'fake')", [dm, alice]),
      ),
      /row-level security/,
    );
  });

  await check("members cannot insert system messages", async () => {
    await expectError(
      as(bob, ({ q }) =>
        q("insert into public.messages (conversation_id, sender_id, kind, body) values ($1, $2, 'system', 'x')", [
          dm,
          bob,
        ]),
      ),
      /row-level security/,
    );
  });

  await check("unread counts reflect messages from others", async () => {
    const [c] = await as(bob, ({ q }) =>
      q("select unread_count, title from public.list_my_conversations() where conversation_id = $1", [dm]),
    );
    assert(c.unread_count === 1, `unread was ${c.unread_count}`);
    assert(c.title === "Alice Example", `title was ${c.title}`);
    await as(bob, ({ q }) => q("select public.mark_conversation_read($1)", [dm]));
    const [after] = await as(bob, ({ q }) =>
      q("select unread_count from public.list_my_conversations() where conversation_id = $1", [dm]),
    );
    assert(after.unread_count === 0, "still unread after marking read");
  });

  await check("read receipts show other members' read markers only to members", async () => {
    const forAlice = await as(alice, ({ q }) => q("select user_id from public.get_read_receipts($1)", [dm]));
    assert(forAlice.length === 1 && forAlice[0].user_id === bob, `got ${JSON.stringify(forAlice)}`);
    const forMallory = await as(mallory, ({ q }) => q("select user_id from public.get_read_receipts($1)", [dm]));
    assert(forMallory.length === 0, "outsider sees receipts");
  });

  await check("mentions and replies create notifications", async () => {
    await as(bob, ({ q }) =>
      q(
        "insert into public.messages (conversation_id, sender_id, body, mentions, reply_to_id) values ($1, $2, '@Alice Example sure', $3, $4)",
        [dm, bob, [alice], msg1],
      ),
    );
    const n = await as(alice, ({ q }) => q("select kind, title from public.notifications"));
    assert(n.length === 1 && n[0].kind === "mention", `got ${JSON.stringify(n)}`);
    const peek = await as(mallory, ({ q }) => q("select * from public.notifications"));
    assert(peek.length === 0, "mallory sees others' notifications");
  });

  await check("mentioning an outsider does not notify them", async () => {
    await as(alice, ({ q }) =>
      q("insert into public.messages (conversation_id, sender_id, body, mentions) values ($1, $2, 'cc', $3)", [
        dm,
        alice,
        [mallory],
      ]),
    );
    const n = await as(mallory, ({ q }) => q("select * from public.notifications"));
    assert(n.length === 0, "outsider was notified");
  });

  await check("replies must stay in the same conversation", async () => {
    const other = (await as(alice, ({ one }) => one("select public.get_or_create_direct_conversation($1) as id", [mallory]))).id;
    await expectError(
      as(alice, ({ q }) =>
        q("insert into public.messages (conversation_id, sender_id, body, reply_to_id) values ($1, $2, 'x', $3)", [
          other,
          alice,
          msg1,
        ]),
      ),
      /same conversation/,
    );
  });

  await check("senders edit their own messages and edited_at is set", async () => {
    await as(alice, ({ q }) => q("update public.messages set body = 'Hello Bob!' where id = $1", [msg1]));
    const [m] = await rows("select body, edited_at from public.messages where id = $1", [msg1]);
    assert(m.body === "Hello Bob!" && m.edited_at !== null, "edit not applied");
  });

  await check("members cannot edit other people's messages", async () => {
    const r = await as(bob, ({ q }) => q("update public.messages set body = 'changed' where id = $1 returning id", [msg1]));
    assert(r.length === 0, "bob edited alice's message");
  });

  await check("edit window is enforced", async () => {
    await db.query("update public.organization_settings set message_edit_window_minutes = 5");
    await db.query("update public.messages set created_at = now() - interval '1 hour' where id = $1", [msg1]);
    await expectError(
      as(alice, ({ q }) => q("update public.messages set body = 'late edit' where id = $1", [msg1])),
      /only be edited for 5 minutes/,
    );
    await db.query("update public.organization_settings set message_edit_window_minutes = null");
  });

  await check("reactions: members react, outsiders cannot", async () => {
    await as(bob, ({ q }) => q("insert into public.message_reactions (message_id, user_id, emoji) values ($1, $2, 'ðŸ‘')", [msg1, bob]));
    await expectError(
      as(mallory, ({ q }) =>
        q("insert into public.message_reactions (message_id, user_id, emoji) values ($1, $2, 'ðŸ‘Ž')", [msg1, mallory]),
      ),
      /row-level security/,
    );
  });

  await check("admins moderate (soft-delete) and it is audited", async () => {
    // The admin must be able to see the conversation to moderate it.
    const group = (
      await as(alice, ({ one }) => one("select public.create_group_conversation($1, 'Site crew') as id", [[bob, admin]]))
    ).id;
    const m = await as(bob, ({ one }) =>
      one("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'oops') returning id", [group, bob]),
    );
    await as(admin, ({ q }) => q("update public.messages set deleted_at = now() where id = $1", [m.id]));
    const [after] = await rows("select body, deleted_by from public.messages where id = $1", [m.id]);
    assert(after.body === "" && after.deleted_by === admin, "not soft-deleted");
    const audit = await rows("select * from public.audit_logs where action = 'message.moderated_delete'");
    assert(audit.length === 1, "moderation not audited");
  });

  await check("group membership changes go through RPCs", async () => {
    const group = (
      await as(alice, ({ one }) => one("select public.create_group_conversation($1) as id", [[bob]]))
    ).id;
    await expectError(
      as(mallory, ({ q }) => q("select public.add_conversation_members($1, $2)", [group, [mallory]])),
      /group chats you belong to/,
    );
    await expectError(
      as(mallory, ({ q }) =>
        q("insert into public.conversation_members (conversation_id, user_id) values ($1, $2)", [group, mallory]),
      ),
      /row-level security/,
    );
    const added = await as(bob, ({ one }) => one("select public.add_conversation_members($1, $2) as n", [group, [carl]]));
    assert(added.n === 1, "bob could not add carl");
    await expectError(
      as(bob, ({ q }) => q("select public.remove_conversation_member($1, $2)", [group, alice])),
      /Only the group owner/,
    );
    await as(alice, ({ q }) => q("select public.remove_conversation_member($1, $2)", [group, carl]));
    const carlSees = await as(carl, ({ q }) => q("select id from public.messages where conversation_id = $1", [group]));
    assert(carlSees.length === 0, "removed member still reads messages");
  });

  console.log("\nTeams and channels");

  await check("employees cannot create teams under the default policy", async () => {
    await expectError(
      as(alice, ({ q }) => q("insert into public.teams (name, created_by) values ('Rogue', $1)", [alice])),
      /row-level security/,
    );
  });

  // The app generates ids client-side and inserts without RETURNING.
  const team = randomUUID();
  await as(manager, ({ q }) =>
    q("insert into public.teams (id, name, description, created_by) values ($1, 'O&M Rajasthan', 'Plant ops', $2)", [
      team,
      manager,
    ]),
  );

  await check("new team gets its creator as owner and a General channel", async () => {
    const m = await rows("select role from public.team_members where team_id = $1 and user_id = $2", [team, manager]);
    assert(m[0]?.role === "owner", "creator is not owner");
    const ch = await rows("select name, is_general from public.channels where team_id = $1", [team]);
    assert(ch.length === 1 && ch[0].is_general, "no General channel");
  });

  const general = (await rows("select c.id from public.conversations c join public.channels ch on ch.id = c.channel_id where ch.team_id = $1", [team]))[0].id;

  await check("anyone can join a public team and then read its channels", async () => {
    await as(alice, ({ q }) => q("insert into public.team_members (team_id, user_id) values ($1, $2)", [team, alice]));
    await as(manager, ({ q }) =>
      q("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Welcome')", [general, manager]),
    );
    const r = await as(alice, ({ q }) => q("select body from public.messages where conversation_id = $1", [general]));
    assert(r.some((x) => x.body === "Welcome"), "alice cannot read General");
    const out = await as(mallory, ({ q }) => q("select body from public.messages where conversation_id = $1", [general]));
    assert(out.length === 0, "non-member read channel");
  });

  await check("self-join cannot grant ownership", async () => {
    await expectError(
      as(bob, ({ q }) =>
        q("insert into public.team_members (team_id, user_id, role) values ($1, $2, 'owner')", [team, bob]),
      ),
      /row-level security/,
    );
  });

  await check("members cannot add other people; owners can, with a notification", async () => {
    await expectError(
      as(alice, ({ q }) => q("insert into public.team_members (team_id, user_id) values ($1, $2)", [team, mallory])),
      /row-level security/,
    );
    await as(manager, ({ q }) => q("insert into public.team_members (team_id, user_id) values ($1, $2)", [team, bob]));
    const n = await as(bob, ({ q }) => q("select kind from public.notifications where kind = 'team_invite'"));
    assert(n.length === 1, "no team invite notification");
  });

  await check("private channels are limited to their members", async () => {
    const ch = await as(manager, ({ one }) =>
      one("insert into public.channels (team_id, name, visibility) values ($1, 'Leads', 'private') returning id", [team]),
    );
    const conv = (await rows("select id from public.conversations where channel_id = $1", [ch.id]))[0].id;
    await as(manager, ({ q }) =>
      q("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'leads only')", [conv, manager]),
    );
    const aliceSees = await as(alice, ({ q }) => q("select id from public.channels where id = $1", [ch.id]));
    assert(aliceSees.length === 0, "alice sees the private channel");
    await as(manager, ({ q }) => q("insert into public.channel_members (channel_id, user_id) values ($1, $2)", [ch.id, alice]));
    const now = await as(alice, ({ q }) => q("select body from public.messages where conversation_id = $1", [conv]));
    assert(now.length === 1, "alice still cannot read after being added");
    await expectError(
      as(manager, ({ q }) => q("insert into public.channel_members (channel_id, user_id) values ($1, $2)", [ch.id, mallory])),
      /Add the person to the team/,
    );
  });

  await check("members cannot create channels or post General copies", async () => {
    await expectError(
      as(alice, ({ q }) => q("insert into public.channels (team_id, name) values ($1, 'random')", [team])),
      /row-level security/,
    );
  });

  await check("the last team owner cannot leave", async () => {
    await expectError(
      as(manager, ({ q }) => q("delete from public.team_members where team_id = $1 and user_id = $2", [team, manager])),
      /at least one owner/,
    );
  });

  await check("archived teams are read-only", async () => {
    await as(manager, ({ q }) => q("update public.teams set archived_at = now() where id = $1", [team]));
    await expectError(
      as(alice, ({ q }) =>
        q("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'late')", [general, alice]),
      ),
      /row-level security/,
    );
    await as(manager, ({ q }) => q("update public.teams set archived_at = null where id = $1", [team]));
  });

  await check("list_my_channels returns the team's channels for members", async () => {
    const r = await as(alice, ({ q }) => q("select channel_name from public.list_my_channels()"));
    assert(r.length === 2, `got ${r.length}`);
    const m = await as(mallory, ({ q }) => q("select channel_name from public.list_my_channels()"));
    assert(m.length === 0, "mallory sees channels");
  });

  console.log("\nAttachments and storage");

  await check("attachment uploads are scoped to conversation and uploader", async () => {
    await as(alice, ({ q }) =>
      q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [`${dm}/${alice}/x-report.pdf`]),
    );
    await expectError(
      as(mallory, ({ q }) =>
        q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [`${dm}/${mallory}/evil.pdf`]),
      ),
      /row-level security/,
    );
    await expectError(
      as(bob, ({ q }) =>
        q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [`${dm}/${alice}/spoof.pdf`]),
      ),
      /row-level security/,
    );
  });

  await check("attachment files become readable only when linked to a message", async () => {
    const path = `${dm}/${alice}/x-report.pdf`;
    let visible = await as(bob, ({ q }) => q("select name from storage.objects where name = $1", [path]));
    assert(visible.length === 0, "unlinked file visible");
    const m = await as(alice, ({ one }) =>
      one("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, '') returning id", [dm, alice]),
    );
    await as(alice, ({ q }) =>
      q(
        "insert into public.attachments (message_id, conversation_id, uploader_id, object_path, file_name, mime_type, size_bytes) values ($1, $2, $3, $4, 'report.pdf', 'application/pdf', 1024)",
        [m.id, dm, alice, path],
      ),
    );
    visible = await as(bob, ({ q }) => q("select name from storage.objects where name = $1", [path]));
    assert(visible.length === 1, "linked file not visible to member");
    const outsider = await as(mallory, ({ q }) => q("select name from storage.objects where name = $1", [path]));
    assert(outsider.length === 0, "outsider can see file");
    await as(alice, ({ q }) => q("update public.messages set deleted_at = now() where id = $1", [m.id]));
    visible = await as(bob, ({ q }) => q("select name from storage.objects where name = $1", [path]));
    assert(visible.length === 0, "file still visible after message deletion");
  });

  await check("attachments respect the configured size limit", async () => {
    const m = await as(alice, ({ one }) =>
      one("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'big') returning id", [dm, alice]),
    );
    await expectError(
      as(alice, ({ q }) =>
        q(
          "insert into public.attachments (message_id, conversation_id, uploader_id, object_path, file_name, mime_type, size_bytes) values ($1, $2, $3, $4, 'big.zip', 'application/zip', 40000000)",
          [m.id, dm, alice, `${dm}/${alice}/big.zip`],
        ),
      ),
      /smaller than 25 MB/,
    );
  });

  console.log("\nRealtime topics");

  await check("conversation topics are limited to members", async () => {
    await as(bob, ({ q }) => q("insert into realtime.messages (topic, extension) values ($1, 'broadcast')", [`conversation:${dm}`]), {
      topic: `conversation:${dm}`,
    });
    await expectError(
      as(
        mallory,
        ({ q }) => q("insert into realtime.messages (topic, extension) values ($1, 'broadcast')", [`conversation:${dm}`]),
        { topic: `conversation:${dm}` },
      ),
      /row-level security/,
    );
  });

  console.log("\nCalls (server-written)");

  await check("members cannot create call rows directly", async () => {
    await expectError(
      as(alice, ({ q }) =>
        q("insert into public.calls (conversation_id, started_by, room_name) values ($1, $2, 'r1')", [dm, alice]),
      ),
      /row-level security/,
    );
  });

  await check("server-created calls notify members and post system messages", async () => {
    const call = await service(({ one }) =>
      one("insert into public.calls (conversation_id, started_by, room_name, media) values ($1, $2, 'room-1', 'audio') returning id", [
        dm,
        alice,
      ]),
    );
    const n = await as(bob, ({ q }) => q("select title from public.notifications where kind = 'call'"));
    assert(n.length === 1, "bob not notified of call");
    await service(({ q }) =>
      q("update public.calls set status = 'ended', ended_at = now(), ended_by = $2 where id = $1", [call.id, alice]),
    );
    const sys = await rows("select body from public.messages where conversation_id = $1 and kind = 'system' order by created_at", [dm]);
    assert(sys.some((m) => m.body.startsWith("started an audio call")), "no start message");
    assert(sys.some((m) => m.body.startsWith("Call ended")), "no end message");
    const visible = await as(bob, ({ q }) => q("select id from public.calls"));
    assert(visible.length === 1, "bob cannot see call history");
    const hidden = await as(mallory, ({ q }) => q("select id from public.calls where conversation_id = $1", [dm]));
    assert(hidden.length === 0, "mallory sees call");
  });

  console.log("\nCall ringing");

  await check("a new direct call rings the other member only", async () => {
    const call = await service(({ one }) =>
      one("insert into public.calls (conversation_id, started_by, room_name, media) values ($1, $2, 'ring-1', 'video') returning id", [dm, alice]),
    );
    const forBob = await as(bob, ({ q }) => q("select status from public.call_invites where call_id = $1 and user_id = $2", [call.id, bob]));
    assert(forBob.length === 1 && forBob[0].status === "ringing", "bob is not ringing");
    const forAlice = await as(alice, ({ q }) => q("select user_id from public.call_invites where call_id = $1", [call.id]));
    assert(forAlice.length === 1 && forAlice[0].user_id === bob, "caller can't see who is ringing, or rang herself");
    const forMallory = await as(mallory, ({ q }) => q("select 1 from public.call_invites where call_id = $1", [call.id]));
    assert(forMallory.length === 0, "outsider sees the ring");
    // Bob declines; the caller sees it.
    const res = await as(bob, ({ one }) => one("select public.respond_to_call($1, 'declined') as s", [call.id]));
    assert(res.s === "declined", `respond returned ${res.s}`);
    const seen = await as(alice, ({ one }) => one("select status from public.call_invites where call_id = $1", [call.id]));
    assert(seen.status === "declined", "caller doesn't see the decline");
    // No update policy: a direct write affects no rows.
    await as(bob, ({ q }) => q("update public.call_invites set status = 'accepted' where call_id = $1", [call.id]));
    const still = await rows("select status from public.call_invites where call_id = $1", [call.id]);
    assert(still[0].status === "declined", "direct update changed the ring");
    await service(({ q }) => q("update public.calls set status = 'ended', ended_at = now(), ended_by = $2 where id = $1", [call.id, alice]));
  });

  await check("joining answers the ring; unanswered rings become missed calls with a notification", async () => {
    const g = (await as(alice, ({ one }) => one("select public.create_group_conversation($1, 'Ring test') as id", [[bob, manager]]))).id;
    const call = await service(({ one }) =>
      one("insert into public.calls (conversation_id, started_by, room_name, media) values ($1, $2, 'ring-2', 'audio') returning id", [g, alice]),
    );
    await service(({ q }) => q("insert into public.call_participants (call_id, user_id) values ($1, $2)", [call.id, bob]));
    await service(({ q }) => q("update public.calls set status = 'ended', ended_at = now(), ended_by = $2 where id = $1", [call.id, alice]));
    const r = await rows("select user_id, status from public.call_invites where call_id = $1 order by user_id", [call.id]);
    const byUser = Object.fromEntries(r.map((x) => [x.user_id, x.status]));
    assert(byUser[bob] === "accepted", `bob: ${byUser[bob]}`);
    assert(byUser[manager] === "missed", `manager: ${byUser[manager]}`);
    const n = await as(manager, ({ q }) => q("select title from public.notifications where call_id = $1 and kind = 'system'", [call.id]));
    assert(n.length === 1 && /^Missed audio call from Alice/.test(n[0].title), `missed notification: ${JSON.stringify(n)}`);
    const nb = await as(bob, ({ q }) => q("select 1 from public.notifications where call_id = $1 and kind = 'system'", [call.id]));
    assert(nb.length === 0, "bob joined but got a missed-call notice");
  });

  await check("ring timeout records a missed call; respond_to_call validates input", async () => {
    const call = await service(({ one }) =>
      one("insert into public.calls (conversation_id, started_by, room_name, media) values ($1, $2, 'ring-3', 'video') returning id", [dm, bob]),
    );
    const res = await as(alice, ({ one }) => one("select public.respond_to_call($1, 'missed') as s", [call.id]));
    assert(res.s === "missed", `got ${res.s}`);
    const n = await as(alice, ({ q }) => q("select 1 from public.notifications where call_id = $1 and kind = 'system'", [call.id]));
    assert(n.length === 1, "no missed notification on timeout");
    await expectError(as(alice, ({ q }) => q("select public.respond_to_call($1, 'accepted')", [call.id])), /declined or missed/);
    await expectError(as(alice, ({ q }) => q("select public.notify_missed_call($1, $2)", [call.id, alice])), /permission denied/);
    await service(({ q }) => q("update public.calls set status = 'ended', ended_at = now(), ended_by = $2 where id = $1", [call.id, bob]));
    const again = await as(alice, ({ q }) => q("select 1 from public.notifications where call_id = $1 and kind = 'system'", [call.id]));
    assert(again.length === 1, "duplicate missed notification after the call ended");
  });

  console.log("\nMeetings");

  const soon = new Date(Date.now() + 10 * 60_000).toISOString();
  const later = new Date(Date.now() + 70 * 60_000).toISOString();
  const mt = (await as(alice, ({ one }) =>
    one("select public.create_meeting('Plant review', $1, $2, $3, 'Agenda', null, false) as id", [soon, later, [bob]]),
  )).id;
  const mrow = await rows("select * from public.meetings where id = $1", [mt]);

  await check("scheduling creates the meeting, its chat and invitations", async () => {
    assert(mrow[0].code.length === 10 && /^[A-Z0-9]{6}$/.test(mrow[0].passcode), "code/passcode format");
    const members = await rows("select user_id from public.conversation_members where conversation_id = $1 and left_at is null", [mrow[0].conversation_id]);
    assert(members.length === 2, `members ${members.length}`);
    const n = await as(bob, ({ q }) => q("select title from public.notifications where meeting_id = $1", [mt]));
    assert(n.length === 1 && n[0].title.includes("invited you to Plant review"), "bob not invited");
    const list = await as(bob, ({ q }) => q("select title, my_response from public.list_my_meetings(now() - interval '1 day', now() + interval '1 day')"));
    assert(list.some((r) => r.title === "Plant review" && r.my_response === "pending"), "not in bob's calendar");
  });

  await check("outsiders can't see a meeting; the link reveals nothing to them but the title", async () => {
    const seen = await as(mallory, ({ q }) => q("select id from public.meetings where id = $1", [mt]));
    assert(seen.length === 0, "mallory sees the meeting");
    const link = await as(mallory, ({ one }) => one("select is_member, conversation_id from public.meeting_by_code($1)", [mrow[0].code]));
    assert(link.is_member === false && link.conversation_id === null, "link leaked the conversation");
  });

  await check("invitees respond; only the organizer (or admin) can change or cancel", async () => {
    await as(bob, ({ q }) => q("select public.respond_to_meeting($1, 'tentative')", [mt]));
    const r = await rows("select response from public.meeting_invitees where meeting_id = $1 and user_id = $2", [mt, bob]);
    assert(r[0].response === "tentative", "response not saved");
    await expectError(as(bob, ({ q }) => q("select public.cancel_meeting($1)", [mt])), /organizer or an administrator/);
    await as(alice, ({ q }) => q("select public.update_meeting($1, 'Plant review v2', $2, $3, null, false, $4)", [mt, soon, later, [manager]]));
    const inv = await rows("select user_id from public.meeting_invitees where meeting_id = $1", [mt]);
    assert(inv.length === 3, `invitees ${inv.length}`);
    const conv = await as(manager, ({ q }) => q("select 1 from public.conversation_members where conversation_id = $1 and user_id = $2", [mrow[0].conversation_id, manager]));
    assert(conv.length === 1, "added invitee not in the meeting chat");
  });

  await check("uninvited employees wait in the lobby until the organizer admits them", async () => {
    await expectError(as(mallory, ({ q }) => q("select public.request_meeting_access($1, 'WRONG1')", [mrow[0].code])), /incorrect/);
    const lobby = (await as(mallory, ({ one }) => one("select public.request_meeting_access($1, $2) as id", [mrow[0].code, mrow[0].passcode]))).id;
    assert(lobby, "no lobby row");
    await expectError(as(bob, ({ q }) => q("select public.decide_lobby($1, true)", [lobby])), /organizer or an administrator/);
    const st = await as(alice, ({ one }) => one("select public.decide_lobby($1, true) as s", [lobby]));
    assert(st.s === "admitted", `status ${st.s}`);
    const now = await as(mallory, ({ q }) => q("select id from public.meetings where id = $1", [mt]));
    assert(now.length === 1, "admitted person still can't see the meeting");
  });

  await check("meeting calls don't ring; attendance comes from the call records", async () => {
    const call = await service(({ one }) =>
      one("insert into public.calls (conversation_id, started_by, room_name) values ($1, $2, 'meet-1') returning id", [mrow[0].conversation_id, alice]),
    );
    const rings = await rows("select 1 from public.call_invites where call_id = $1", [call.id]);
    assert(rings.length === 0, "a scheduled meeting rang people");
    await service(({ q }) => q("insert into public.call_participants (call_id, user_id) values ($1, $2), ($1, $3)", [call.id, alice, bob]));
    const att = await as(alice, ({ q }) => q("select user_id from public.meeting_attendance($1) where user_id is not null", [mt]));
    assert(att.length === 2, `attendance rows ${att.length}`);
    const none = await as(sue, ({ q }) => q("select * from public.meeting_attendance($1)", [mt]));
    assert(none.length === 0, "non-viewer saw attendance");
    await service(({ q }) => q("update public.calls set status = 'ended', ended_at = now() where id = $1", [call.id]));
  });

  await check("reminders go out once, 15 minutes before; cancelling notifies invitees", async () => {
    const sent = await service(({ one }) => one("select public.send_meeting_reminders() as n"));
    assert(sent.n >= 1, "no reminder sent");
    const again = await service(({ one }) => one("select public.send_meeting_reminders() as n"));
    assert(again.n === 0, "reminder sent twice");
    await expectError(as(alice, ({ q }) => q("select public.send_meeting_reminders()")), /permission denied/);
    const rem = await as(bob, ({ q }) => q("select 1 from public.notifications where meeting_id = $1 and title like 'Starting soon%'", [mt]));
    assert(rem.length === 1, "bob got no reminder");
    await as(alice, ({ q }) => q("select public.cancel_meeting($1)", [mt]));
    const c = await as(bob, ({ q }) => q("select 1 from public.notifications where meeting_id = $1 and title like 'Meeting cancelled%'", [mt]));
    assert(c.length === 1, "bob not told about the cancellation");
  });

  await check("guest meetings need the organization setting; channel meetings need channel members", async () => {
    await expectError(
      as(alice, ({ q }) => q("select public.create_meeting('Guests', $1, $2, '{}', null, null, true)", [soon, later])),
      /Guest access to meetings is turned off/,
    );
    const ch = (await rows("select ch.id from public.channels ch join public.teams t on t.id = ch.team_id where t.name = 'O&M Rajasthan' and ch.is_general"))[0];
    await expectError(
      as(manager, ({ q }) => q("select public.create_meeting('Ops sync', $1, $2, $3, null, $4, false)", [soon, later, [mallory], ch.id])),
      /not members of that channel/,
    );
  });

  await check("signed-out (anon) callers can't use any meeting, ringing or chat-workspace function", async () => {
    const calls = [
      "select public.list_my_meetings(now(), now())",
      "select public.meeting_by_code('1234567890')",
      "select public.request_meeting_access('1234567890', 'AAAAAA')",
      "select public.create_meeting('x', now(), now() + interval '1 hour')",
      "select public.respond_to_call(gen_random_uuid(), 'declined')",
      "select public.pin_message(gen_random_uuid(), true)",
      "select public.find_group_conversation('{}')",
    ];
    for (const sql of calls) {
      await expectError(as(null, ({ q }) => q(sql), { role: "anon" }), /permission denied/);
    }
    const leaked = await as(null, ({ q }) => q("select count(*)::int as n from public.meetings"), { role: "anon" }).catch(() => [{ n: 0 }]);
    assert(leaked[0].n === 0, "anon can read meetings");
  });

  console.log("\nAdministration");

  await check("only admins change organization settings", async () => {
    const r = await as(alice, ({ q }) =>
      q("update public.organization_settings set calls_enabled = false returning id"),
    );
    assert(r.length === 0, "employee changed settings");
    await as(admin, ({ q }) => q("update public.organization_settings set directory_show_phone = true"));
    const audit = await rows(
      "select metadata from public.audit_logs where action = 'organization_settings.updated' and actor_id = $1",
      [admin],
    );
    assert(audit.length === 1 && audit[0].metadata.changed.includes("directory_show_phone"), "settings change not audited");
  });

  await check("departments are admin-managed and audited", async () => {
    await expectError(
      as(alice, ({ q }) => q("insert into public.departments (name) values ('Shadow IT')")),
      /row-level security/,
    );
    await as(admin, ({ q }) => q("insert into public.departments (name) values ('O&M / Service')"));
    const audit = await rows("select * from public.audit_logs where action = 'department.created'");
    assert(audit.length === 1, "department not audited");
  });

  await check("audit log is admin-readable and append-only", async () => {
    const forAlice = await as(alice, ({ q }) => q("select id from public.audit_logs"));
    assert(forAlice.length === 0, "employee can read audit");
    const forAdmin = await as(admin, ({ q }) => q("select id from public.audit_logs"));
    assert(forAdmin.length > 0, "admin cannot read audit");
    await expectError(as(alice, ({ q }) => q("insert into public.audit_logs (action) values ('fake')")), /row-level security|permission denied/);
    await expectError(db.query("update public.audit_logs set action = 'x'"), /append-only/);
    await expectError(db.query("delete from public.audit_logs"), /append-only/);
  });

  await check("usage summary is admin-only", async () => {
    await expectError(as(bob, ({ q }) => q("select * from public.admin_usage_summary()")), /Administrator access/);
    const [s] = await as(owner, ({ q }) => q("select * from public.admin_usage_summary()"));
    assert(Number(s.messages_7d) > 0, "no messages counted");
  });

  await check("teams policy 'everyone' lets employees create teams", async () => {
    await db.query("update public.organization_settings set team_creation = 'everyone'");
    await as(bob, ({ q }) => q("insert into public.teams (name, created_by) values ('Finance', $1)", [bob]));
    await db.query("update public.organization_settings set team_creation = 'managers'");
  });

  await check("private teams are hidden from non-members", async () => {
    const t = { id: randomUUID() };
    await as(manager, ({ q }) =>
      q("insert into public.teams (id, name, visibility, created_by) values ($1, 'Board', 'private', $2)", [t.id, manager]),
    );
    const r = await as(alice, ({ q }) => q("select team_id from public.list_teams() where team_id = $1", [t.id]));
    assert(r.length === 0, "private team visible");
    await expectError(
      as(alice, ({ q }) => q("insert into public.team_members (team_id, user_id) values ($1, $2)", [t.id, alice])),
      /row-level security/,
    );
  });

  console.log("\nChat workspace (favourites, receipts, pins, forwards, stickers)");

  await check("favourites are per person", async () => {
    await as(alice, ({ q }) => q("select public.set_conversation_preferences($1, p_is_favorite => true)", [dm]));
    const a = await as(alice, ({ one }) => one("select is_favorite from public.list_my_conversations() where conversation_id = $1", [dm]));
    const b = await as(bob, ({ one }) => one("select is_favorite from public.list_my_conversations() where conversation_id = $1", [dm]));
    assert(a?.is_favorite === true, "alice's favourite not saved");
    assert(b?.is_favorite === false, "favourite leaked to bob");
  });

  await check("delivered receipts are recorded and visible only to members", async () => {
    await as(bob, ({ q }) => q("select public.mark_conversations_delivered()"));
    const r = await as(alice, ({ q }) => q("select user_id, last_delivered_at from public.get_message_receipts($1)", [dm]));
    assert(r.length === 1 && r[0].user_id === bob && r[0].last_delivered_at, "bob's delivery not visible to alice");
    const out = await as(mallory, ({ q }) => q("select * from public.get_message_receipts($1)", [dm]));
    assert(out.length === 0, "outsider saw receipts");
  });

  await check("members pin and unpin messages; outsiders and direct updates cannot", async () => {
    await as(bob, ({ q }) => q("select public.pin_message($1, true)", [msg1]));
    let m = await as(alice, ({ one }) => one("select pinned_at, pinned_by from public.messages where id = $1", [msg1]));
    assert(m.pinned_at && m.pinned_by === bob, "pin not recorded");
    await expectError(as(mallory, ({ q }) => q("select public.pin_message($1, false)", [msg1])), /not found/);
    await expectError(
      as(alice, ({ q }) => q("update public.messages set pinned_at = null where id = $1", [msg1])),
      /pin_message/,
    );
    await as(alice, ({ q }) => q("select public.pin_message($1, false)", [msg1]));
    m = await as(alice, ({ one }) => one("select pinned_at from public.messages where id = $1", [msg1]));
    assert(m.pinned_at === null, "unpin failed");
  });

  await check("forwards must point at a message the sender can see", async () => {
    const self = (await as(alice, ({ one }) => one("select public.get_or_create_direct_conversation($1) as id", [admin]))).id;
    await as(alice, ({ q }) =>
      q("insert into public.messages (conversation_id, sender_id, body, forwarded_from_id) values ($1, $2, 'Hello Bob', $3)", [
        self,
        alice,
        msg1,
      ]),
    );
    const mal = (await as(mallory, ({ one }) => one("select public.get_or_create_direct_conversation($1) as id", [admin]))).id;
    await expectError(
      as(mallory, ({ q }) =>
        q("insert into public.messages (conversation_id, sender_id, body, forwarded_from_id) values ($1, $2, 'stolen', $3)", [
          mal,
          mallory,
          msg1,
        ]),
      ),
      /only forward messages you can see/,
    );
  });

  await check("stickers are validated and cannot be swapped by editing", async () => {
    const s = await as(alice, ({ one }) =>
      one("insert into public.messages (conversation_id, sender_id, body, sticker) values ($1, $2, '', 'thumbs-up') returning id", [
        dm,
        alice,
      ]),
    );
    await expectError(
      as(alice, ({ q }) => q("insert into public.messages (conversation_id, sender_id, body, sticker) values ($1, $2, '', 'Bad Sticker!')", [dm, alice])),
      /messages_sticker_format/,
    );
    await expectError(
      as(alice, ({ q }) => q("update public.messages set sticker = 'party' where id = $1", [s.id])),
      /Only the message text/,
    );
    const row = await as(bob, ({ one }) => one("select last_message_preview from public.list_my_conversations() where conversation_id = $1", [dm]));
    assert(row.last_message_preview === "Sent a sticker", `preview was ${row.last_message_preview}`);
  });

  await check("existing group chats are found instead of duplicated", async () => {
    const g = (await as(alice, ({ one }) => one("select public.create_group_conversation($1, 'Dedup') as id", [[bob, manager]]))).id;
    const same = await as(bob, ({ one }) => one("select public.find_group_conversation($1) as id", [[alice, manager]]));
    assert(same.id === g, "existing group not found for the same member set");
    const different = await as(bob, ({ one }) => one("select public.find_group_conversation($1) as id", [[alice]]));
    assert(different.id !== g, "returned a group with different members");
    const outsider = await as(mallory, ({ one }) => one("select public.find_group_conversation($1) as id", [[alice, bob]]));
    assert(outsider.id !== g, "outsider found someone else's group");
  });

  await check("chat list includes my team channels but not other teams' channels", async () => {
    const t = randomUUID();
    await as(manager, ({ q }) => q("insert into public.teams (id, name, created_by) values ($1, 'Procurement', $2)", [t, manager]));
    await as(manager, ({ q }) => q("insert into public.team_members (team_id, user_id) values ($1, $2)", [t, alice]));
    const conv = (await rows("select c.id from public.conversations c join public.channels ch on ch.id = c.channel_id where ch.team_id = $1", [t]))[0].id;
    await as(manager, ({ q }) => q("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'PO approved')", [conv, manager]));
    const a = await as(alice, ({ one }) =>
      one("select kind, title, team_name, unread_count from public.list_my_conversations(p_search => 'procurement') where conversation_id = $1", [conv]),
    );
    assert(a?.kind === "channel" && a.team_name === "Procurement" && a.unread_count === 1, `alice row: ${JSON.stringify(a)}`);
    const m = await as(mallory, ({ q }) => q("select 1 from public.list_my_conversations() where conversation_id = $1", [conv]));
    assert(m.length === 0, "channel listed for a non-member");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
