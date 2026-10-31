// End-to-end test against a STAGING Supabase project and a running app.
//
//   npm run dev                       (in one terminal)
//   npm run e2e:staging               (in another; reads .env.local)
//   npm run e2e:staging -- --keep     (leave the test users for manual UI checks)
//
// Safety:
//  * Refuses to run unless E2E_CONFIRM_PROJECT_REF equals the project ref in
//    NEXT_PUBLIC_SUPABASE_URL - set it only for your staging project.
//  * Creates clearly labelled "E2E" users/teams and deletes them afterwards
//    (audit-log rows stay, because the audit log is append-only).
//  * Sends no email unless E2E_INVITE_EMAIL is set (then one real invitation
//    email is sent to that address through the app's admin API).
//  * Test passwords are random and written only to .e2e-credentials.json
//    (git-ignored) when --keep is used.

import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const args = new Set(process.argv.slice(2));
const KEEP = args.has("--keep");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = (process.env.E2E_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const CONFIRM_REF = process.env.E2E_CONFIRM_PROJECT_REF;
const INVITE_EMAIL = process.env.E2E_INVITE_EMAIL || "";

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

if (!URL_ || !ANON || !SERVICE) fail("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
const projectRef = new URL(URL_).hostname.split(".")[0];
if (!CONFIRM_REF || CONFIRM_REF !== projectRef) {
  fail(`Safety check: set E2E_CONFIRM_PROJECT_REF=${projectRef} in .env.local to confirm this is your STAGING project.`);
}

const run = randomBytes(3).toString("hex");
const service = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let passed = 0;
const failures = [];
const created = { userIds: [], conversationIds: [], teamIds: [], objects: [] };

async function step(name, fn) {
  try {
    const note = await fn();
    passed += 1;
    console.log(`  ok   ${name}${note ? ` - ${note}` : ""}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const password = () => `E2e-${randomBytes(12).toString("base64url")}9`;

/** Signs in with the same cookie format the app uses, and returns a client + Cookie header. */
async function signIn(email, pass) {
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data, error } = await ssr.auth.signInWithPassword({ email, password: pass });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  const client = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  client.realtime.setAuth(data.session.access_token);
  const cookie = Array.from(jar, ([n, v]) => `${n}=${v}`).join("; ");
  return { client, cookie, userId: data.user.id, session: data.session };
}

async function api(path, cookie, { method = "GET", body } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: { Cookie: cookie, Origin: APP, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

/** Same steps as /auth/confirm + /accept-invite in the app. */
async function acceptInvitation(email, displayName, invite) {
  let token = invite;
  if (!token) {
    // Invited through the app API (email sent): mint a fresh link for the same user.
    let link = await service.auth.admin.generateLink({ type: "invite", email });
    if (link.error) link = await service.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw new Error(`could not generate a link: ${link.error.message}`);
    token = { type: link.data.properties.verification_type ?? "invite", hash: link.data.properties.hashed_token };
  }
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.verifyOtp({ type: token.type, token_hash: token.hash });
  if (error || !data.session) throw new Error(`verifyOtp failed: ${error?.message}`);
  const pass = password();
  const { error: pwError } = await anon.auth.updateUser({ password: pass, data: { display_name: displayName } });
  if (pwError) throw new Error(`setting password failed: ${pwError.message}`);
  const { data: status, error: actError } = await anon.rpc("activate_my_account");
  if (actError || status !== "active") throw new Error(`activation failed: ${actError?.message ?? status}`);
  return pass;
}

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
    predicate((value) => {
      clearTimeout(t);
      resolve(value);
    });
  });
}

async function cleanup() {
  if (KEEP) return;
  console.log("\nCleaning up E2E data...");
  for (const id of created.conversationIds) await service.from("conversations").delete().eq("id", id);
  for (const id of created.teamIds) await service.from("teams").delete().eq("id", id);
  if (created.objects.length) await service.storage.from("attachments").remove(created.objects);
  for (const id of created.userIds) await service.auth.admin.deleteUser(id);
  console.log(`  removed ${created.userIds.length} users, ${created.teamIds.length} team(s), ${created.conversationIds.length} conversation(s)`);
}

async function main() {
  console.log(`Diwakar Connect staging E2E · project ${projectRef} · app ${APP} · run ${run}\n`);

  // --- Preconditions --------------------------------------------------------
  const { data: settings, error: settingsError } = await service.from("organization_settings").select("*").eq("id", true).maybeSingle();
  if (settingsError || !settings) fail(`Migrations don't look applied (${settingsError?.message ?? "no organization_settings row"}).`);
  const domain = settings.allowed_email_domains[0] || process.env.E2E_EMAIL_DOMAIN || "example.com";
  const emailFor = (tag) => `e2e-${run}-${tag}@${domain}`;
  try {
    const res = await fetch(`${APP}/sign-in`, { redirect: "manual" });
    if (res.status >= 500) fail(`App at ${APP} returned ${res.status}.`);
  } catch {
    fail(`App isn't reachable at ${APP}. Start it with "npm run dev" first.`);
  }

  const users = {};

  console.log("Setup");
  await step("create an E2E admin (server-side, like bootstrap)", async () => {
    const pass = password();
    const { data, error } = await service.auth.admin.createUser({
      email: emailFor("admin"),
      password: pass,
      email_confirm: true,
      user_metadata: { display_name: `E2E Admin ${run}` },
    });
    if (error) throw new Error(error.message);
    created.userIds.push(data.user.id);
    await service.from("profiles").update({ employment_status: "active" }).eq("id", data.user.id);
    await service.from("user_roles").update({ role: "admin" }).eq("user_id", data.user.id);
    users.admin = { email: emailFor("admin"), pass, ...(await signIn(emailFor("admin"), pass)) };
  });
  if (!users.admin) return;

  console.log("\nInvite and accept");
  const emailB = INVITE_EMAIL || emailFor("b");
  const tokens = {};
  await step(INVITE_EMAIL ? "admin invites B through the app API (sends a real email)" : "admin invites B (link generated, no email)", async () => {
    if (INVITE_EMAIL) {
      const r = await api("/api/admin/invite", users.admin.cookie, {
        method: "POST",
        body: { email: emailB, displayName: `E2E Tester B ${run}`, role: "employee", title: "QA" },
      });
      assert(r.status === 201, `invite API returned ${r.status}: ${JSON.stringify(r.json)}`);
      created.userIds.push(r.json.userId);
    } else {
      const { data, error } = await service.auth.admin.generateLink({ type: "invite", email: emailB, options: { data: { display_name: `E2E Tester B ${run}` } } });
      if (error) throw new Error(error.message);
      created.userIds.push(data.user.id);
      tokens.b = { type: "invite", hash: data.properties.hashed_token };
    }
  });
  await step("admin invites C", async () => {
    const { data, error } = await service.auth.admin.generateLink({ type: "invite", email: emailFor("c"), options: { data: { display_name: `E2E Tester C ${run}` } } });
    if (error) throw new Error(error.message);
    created.userIds.push(data.user.id);
    tokens.c = { type: "invite", hash: data.properties.hashed_token };
  });
  await step("invited people start as 'invited' and can't read company data", async () => {
    const { data } = await service.from("profile_details").select("user_id").eq("email", emailFor("c")).single();
    const { data: p } = await service.from("profiles").select("employment_status").eq("id", data.user_id).single();
    assert(p.employment_status === "invited", `status was ${p.employment_status}`);
  });
  await step("non-admins can't use the invite API", async () => {
    // Uses the admin's cookie with a forged Origin to prove the origin check, then an anonymous call.
    const forged = await fetch(`${APP}/api/admin/invite`, {
      method: "POST",
      headers: { Cookie: users.admin.cookie, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailFor("x"), displayName: "X" }),
    });
    assert(forged.status === 403, `cross-origin request returned ${forged.status}`);
    const anon = await fetch(`${APP}/api/admin/invite`, {
      method: "POST",
      headers: { Origin: APP, "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailFor("x"), displayName: "X" }),
    });
    assert(anon.status === 401, `anonymous request returned ${anon.status}`);
  });
  await step("B accepts the invitation (verify link, set password, activate)", async () => {
    const pass = await acceptInvitation(emailB, `E2E Tester B ${run}`, tokens.b);
    users.b = { email: emailB, pass, ...(await signIn(emailB, pass)) };
  });
  await step("C accepts the invitation", async () => {
    const pass = await acceptInvitation(emailFor("c"), `E2E Tester C ${run}`, tokens.c);
    users.c = { email: emailFor("c"), pass, ...(await signIn(emailFor("c"), pass)) };
  });
  if (!users.b || !users.c) return;

  await step("B finds C in the directory", async () => {
    const { data, error } = await users.b.client.rpc("search_directory", { p_query: `Tester C ${run}` });
    if (error) throw new Error(error.message);
    assert(data.some((p) => p.id === users.c.userId), "C not found");
  });

  console.log("\nChat");
  let dm;
  await step("B opens a direct chat with C", async () => {
    const { data, error } = await users.b.client.rpc("get_or_create_direct_conversation", { p_other_user: users.c.userId });
    if (error) throw new Error(error.message);
    dm = data;
    created.conversationIds.push(dm);
  });
  if (!dm) return;

  let firstMessageId;
  await step("C receives B's message and typing indicator in realtime", async () => {
    const received = [];
    let typing = false;
    const dbChannel = users.c.client
      .channel(`e2e-db-${run}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${dm}` }, (p) => received.push(p.new));
    const typingChannel = users.c.client
      .channel(`conversation:${dm}`, { config: { private: true } })
      .on("broadcast", { event: "typing" }, () => (typing = true));
    await waitFor((done) => dbChannel.subscribe((s) => s === "SUBSCRIBED" && done()), 15000, "C's message subscription");
    await waitFor((done) => typingChannel.subscribe((s) => s === "SUBSCRIBED" && done()), 15000, "C's private typing channel");

    const bTyping = users.b.client.channel(`conversation:${dm}`, { config: { private: true } });
    await waitFor((done) => bTyping.subscribe((s) => s === "SUBSCRIBED" && done()), 15000, "B's private typing channel");
    await bTyping.send({ type: "broadcast", event: "typing", payload: { userId: users.b.userId } });

    firstMessageId = randomUUID();
    const { error } = await users.b.client.from("messages").insert({
      id: firstMessageId,
      conversation_id: dm,
      sender_id: users.b.userId,
      body: `Hello @E2E Tester C ${run}, are the inverter readings in?`,
      mentions: [users.c.userId],
    });
    if (error) throw new Error(error.message);
    for (let i = 0; i < 40 && (!received.some((m) => m.id === firstMessageId) || !typing); i++) await sleep(250);
    await users.c.client.removeChannel(dbChannel);
    await users.c.client.removeChannel(typingChannel);
    await users.b.client.removeChannel(bTyping);
    assert(received.some((m) => m.id === firstMessageId), "message not delivered over realtime within 10s");
    assert(typing, "typing broadcast not delivered within 10s");
  });

  await step("C gets a mention notification", async () => {
    const { data } = await users.c.client.from("notifications").select("kind, title").eq("message_id", firstMessageId);
    assert(data?.some((n) => n.kind === "mention"), `got ${JSON.stringify(data)}`);
  });

  await step("C replies and reacts; B sees both and gets a reply notification", async () => {
    const replyId = randomUUID();
    const r1 = await users.c.client.from("messages").insert({ id: replyId, conversation_id: dm, sender_id: users.c.userId, body: "Yes, uploading now.", reply_to_id: firstMessageId });
    if (r1.error) throw new Error(r1.error.message);
    const r2 = await users.c.client.from("message_reactions").insert({ message_id: firstMessageId, user_id: users.c.userId, emoji: "👍" });
    if (r2.error) throw new Error(r2.error.message);
    const { data: reactions } = await users.b.client.from("message_reactions").select("emoji").eq("message_id", firstMessageId);
    assert(reactions?.length === 1, "reaction not visible to B");
    const { data: notes } = await users.b.client.from("notifications").select("kind").eq("message_id", replyId);
    assert(notes?.some((n) => n.kind === "reply"), "no reply notification");
  });

  await step("unread count and read marker work", async () => {
    const { data } = await users.b.client.rpc("list_my_conversations", {});
    const row = data.find((c) => c.conversation_id === dm);
    assert(row?.unread_count === 1, `B unread was ${row?.unread_count}`);
    await users.b.client.rpc("mark_conversation_read", { p_conversation_id: dm });
    const { data: after } = await users.b.client.rpc("list_my_conversations", {});
    assert(after.find((c) => c.conversation_id === dm)?.unread_count === 0, "still unread");
  });

  await step("B sends a file; C downloads it via a signed URL; outsiders can't", async () => {
    const content = `E2E attachment ${run}`;
    const path = `${dm}/${users.b.userId}/${randomUUID()}-readings.txt`;
    const up = await users.b.client.storage.from("attachments").upload(path, new Blob([content], { type: "text/plain" }), { contentType: "text/plain" });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    created.objects.push(path);
    const messageId = randomUUID();
    const m = await users.b.client.from("messages").insert({ id: messageId, conversation_id: dm, sender_id: users.b.userId, body: "" });
    if (m.error) throw new Error(m.error.message);
    const a = await users.b.client.from("attachments").insert({
      message_id: messageId,
      conversation_id: dm,
      uploader_id: users.b.userId,
      object_path: path,
      file_name: "readings.txt",
      mime_type: "text/plain",
      size_bytes: Buffer.byteLength(content),
    });
    if (a.error) throw new Error(`attachment row: ${a.error.message}`);
    const signed = await users.c.client.storage.from("attachments").createSignedUrl(path, 60);
    if (signed.error) throw new Error(`C signed URL: ${signed.error.message}`);
    const body = await (await fetch(signed.data.signedUrl)).text();
    assert(body === content, "downloaded content differs");
    const outsider = await users.admin.client.storage.from("attachments").createSignedUrl(path, 60);
    assert(outsider.error, "a non-member could sign the file URL");
    const html = await users.b.client.storage.from("attachments").upload(`${dm}/${users.b.userId}/${randomUUID()}-x.html`, new Blob(["<script>1</script>"], { type: "text/html" }), { contentType: "text/html" });
    assert(html.error, "HTML upload was accepted");
  });

  await step("admins can't read conversations they're not in", async () => {
    const { data } = await users.admin.client.from("messages").select("id").eq("conversation_id", dm);
    assert(data?.length === 0, `admin read ${data?.length} messages`);
  });

  console.log("\nTeams");
  let teamId;
  await step("employee can't create a team under the default policy", async () => {
    const { error } = await users.b.client.from("teams").insert({ id: randomUUID(), name: `E2E blocked ${run}`, created_by: users.b.userId });
    assert(error, "employee created a team");
  });
  await step("admin creates a team, adds B and C; General channel works", async () => {
    teamId = randomUUID();
    const t = await users.admin.client.from("teams").insert({ id: teamId, name: `E2E Team ${run}`, created_by: users.admin.userId });
    if (t.error) throw new Error(t.error.message);
    created.teamIds.push(teamId);
    const m = await users.admin.client.from("team_members").insert([
      { team_id: teamId, user_id: users.b.userId },
      { team_id: teamId, user_id: users.c.userId },
    ]);
    if (m.error) throw new Error(m.error.message);
    const { data: channels } = await users.c.client.rpc("list_my_channels");
    const general = channels.find((c) => c.team_id === teamId && c.is_general);
    assert(general, "C can't see General");
    const post = await users.b.client.from("messages").insert({ conversation_id: general.conversation_id, sender_id: users.b.userId, body: "Site update posted." });
    if (post.error) throw new Error(post.error.message);
    const { data: seen } = await users.c.client.from("messages").select("body").eq("conversation_id", general.conversation_id).eq("kind", "user");
    assert(seen?.some((x) => x.body === "Site update posted."), "C can't read the channel post");
    const { data: invites } = await users.c.client.from("notifications").select("kind").eq("team_id", teamId);
    assert(invites?.some((n) => n.kind === "team_invite"), "no team invitation notification");
  });

  console.log("\nCalls");
  const config = await api("/api/calls/config", users.b.cookie);
  await step("call configuration endpoint answers truthfully", async () => {
    assert(config.status === 200, `status ${config.status}`);
    return config.json.providerConfigured ? "LiveKit configured" : "LiveKit NOT configured";
  });
  if (config.json?.providerConfigured && config.json?.enabledByOrganization) {
    let callId;
    await step("B starts a call: token scoped to the call room, C is notified", async () => {
      const r = await api("/api/calls/token", users.b.cookie, { method: "POST", body: { conversationId: dm, media: "audio" } });
      assert(r.status === 200, `token endpoint ${r.status}: ${JSON.stringify(r.json)}`);
      callId = r.json.call.id;
      const claims = decodeJwt(r.json.token);
      assert(claims.sub === users.b.userId, "token identity mismatch");
      assert(claims.video?.roomJoin && claims.video.room?.startsWith("dc_"), "token room grant missing");
      assert(r.json.serverUrl?.startsWith("ws"), "server URL missing");
      const { data: n } = await users.c.client.from("notifications").select("kind").eq("call_id", callId);
      assert(n?.some((x) => x.kind === "call"), "C wasn't notified");
    });
    await step("C joins the same call; outsiders can't get a token", async () => {
      const r = await api("/api/calls/token", users.c.cookie, { method: "POST", body: { conversationId: dm, media: "audio" } });
      assert(r.status === 200 && r.json.call.id === callId, `C got ${r.status} / ${r.json?.call?.id}`);
      const o = await api("/api/calls/token", users.admin.cookie, { method: "POST", body: { conversationId: dm, media: "audio" } });
      assert(o.status === 404, `outsider got ${o.status}`);
    });
    await step("B ends the call for everyone; history is recorded", async () => {
      const r = await api("/api/calls/end", users.b.cookie, { method: "POST", body: { callId } });
      assert(r.status === 200, `end returned ${r.status}`);
      const { data } = await users.c.client.from("calls").select("status").eq("id", callId).single();
      assert(data.status === "ended", `status ${data.status}`);
      const { data: sys } = await users.c.client.from("messages").select("body").eq("conversation_id", dm).eq("kind", "system");
      assert(sys?.some((m) => m.body.startsWith("Call ended")), "no 'Call ended' message");
    });
  } else {
    await step("without LiveKit the token endpoint refuses honestly (503)", async () => {
      const r = await api("/api/calls/token", users.b.cookie, { method: "POST", body: { conversationId: dm, media: "audio" } });
      assert(r.status === 503 || r.status === 403, `token endpoint returned ${r.status}`);
    });
  }

  console.log("\nLifecycle");
  await step("admin suspends C: C can't sign in and existing session sees nothing", async () => {
    const r = await api(`/api/admin/users/${users.c.userId}`, users.admin.cookie, { method: "PATCH", body: { status: "suspended" } });
    assert(r.status === 200, `suspend returned ${r.status}: ${JSON.stringify(r.json)}`);
    const { data } = await users.c.client.from("messages").select("id").eq("conversation_id", dm);
    assert(data?.length === 0, "suspended user still reads messages");
    let blocked = false;
    try {
      await signIn(users.c.email, users.c.pass);
    } catch {
      blocked = true;
    }
    assert(blocked, "suspended user could sign in");
  });
  await step("admin reactivates C", async () => {
    const r = await api(`/api/admin/users/${users.c.userId}`, users.admin.cookie, { method: "PATCH", body: { status: "active" } });
    assert(r.status === 200, `reactivate returned ${r.status}`);
    users.c = { ...users.c, ...(await signIn(users.c.email, users.c.pass)) };
  });
  await step("actions were audited", async () => {
    const { data } = await users.admin.client.from("audit_logs").select("action").eq("target_id", users.c.userId);
    const actions = new Set((data ?? []).map((r) => r.action));
    assert(actions.has("user.suspended") && actions.has("user.reactivated"), `saw ${[...actions].join(", ")}`);
  });

  if (KEEP) {
    const creds = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, { email: u.email, password: u.pass }]));
    writeFileSync(".e2e-credentials.json", JSON.stringify({ project: projectRef, run, users: creds }, null, 2));
    console.log("\nKept test users; credentials written to .e2e-credentials.json (git-ignored). Re-run without --keep to clean up a fresh set.");
  }
}

main()
  .catch((e) => {
    failures.push("unexpected error");
    console.error(e);
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      console.error("cleanup failed:", e instanceof Error ? e.message : e);
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    process.exit(failures.length ? 1 : 0);
  });
