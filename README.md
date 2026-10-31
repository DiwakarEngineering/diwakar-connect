# Diwakar Connect

Company communications for **Diwakar Solar**: sign-in for invited employees, direct and group chat, teams with channels, audio/video calls, a people directory, notifications, and an admin console.

Built with **Next.js 15 (App Router) + TypeScript + Tailwind CSS**, **Supabase** (Postgres, Auth, Realtime, Storage) and **LiveKit** for WebRTC calls.

---

## Contents

1. [What works](#what-works)
2. [Architecture](#architecture)
3. [Data model](#data-model)
4. [Security model](#security-model)
5. [Local setup](#local-setup)
6. [Supabase project setup](#supabase-project-setup)
7. [Call provider (LiveKit) setup](#call-provider-livekit-setup)
8. [Environment variables](#environment-variables)
9. [Deployment](#deployment)
10. [Checks and tests](#checks-and-tests)
11. [Known limitations](#known-limitations)

---

## What works

| Area | Features |
| --- | --- |
| **Sign in** | Email/password, password reset, invitation acceptance (set name + password), expired-session handling, suspended/deactivated lock-out. No public sign-up. |
| **Home** | Unread mentions & replies, unread chats, live calls, team channels with new posts, quick actions. |
| **Chat** | Searchable list, All / Unread / Pinned filters, unread counts, pin & mute, new direct or group chat. |
| **Conversation** | Realtime messages, cursor pagination, replies + thread panel, @mentions, emoji reactions, edit/delete own messages (per policy), admin moderation, attachments (private bucket, signed URLs), in-conversation search, typing indicator, "Seen" receipts (direct & group), member list, group rename/add/remove/leave. Optimistic sends with retry/discard on failure. |
| **Teams** | Browse & join public teams, private teams, create team (if policy allows), General channel auto-created, standard & private channels, channel members, owner/member roles, archive/restore, delete (admin). |
| **Calls** | LiveKit audio/video from any chat or channel; lobby with camera preview and device selection; mute, camera, screen share, speaker selection, participant roster, invite, leave, end-for-everyone; reconnecting/ended/permission-denied states; call history. Clear "setup needed" state when LiveKit isn't configured. Nothing is recorded. |
| **People** | Directory with search, department filter, server-side pagination, presence, and contact fields governed by directory settings. |
| **Notifications** | Mentions, replies, team invitations and calls; realtime toasts (calls get "Join"); per-category preferences; optional desktop alerts (permission-based, while the app is open). |
| **Profile & settings** | Display name, photo, phone, work location, availability (available / busy / do not disturb / away / appear offline), status message, password change, sign out (this or other devices). |
| **Admin console** | Usage summary, permission matrix, invite users, edit details, roles, suspend / deactivate / reactivate, resend/revoke invitations, departments, teams, append-only audit log, organization settings (domain allowlist, team-creation policy, directory visibility, edit window, deletion policy, attachment limit, calls on/off). |

Design: white and warm off-white canvas, deep navy text, Diwakar orange (`#F06A1A` accents, `#C84C0A` for white-on-orange text at 4.6:1). Desktop has a sidebar (full on large screens, compact rail on tablets) and a top bar with search, presence, notifications and profile menu; mobile has a compact header, profile drawer and bottom navigation. Keyboard focus is always visible; dialogs use native `<dialog>` (focus trapping, Escape); menus, comboboxes and tabs follow WAI-ARIA patterns; live regions announce new messages and status changes.

---

## Architecture

```
Browser (Next.js client components)
  ├─ Supabase JS (anon key + user JWT) ──► PostgREST / Realtime / Storage
  │       every query is filtered by Row Level Security
  └─ fetch /api/* ──► Next.js route handlers (trusted server)
                          ├─ verify caller with their own JWT (RLS-bound client)
                          ├─ service-role client for privileged writes (never sent to browser)
                          └─ LiveKit server SDK (tokens, room control, webhooks)

Supabase Postgres
  ├─ supabase/migrations/*.sql  (schema, triggers, RLS, RPCs, storage, realtime)
  └─ auth.users ──trigger──► profiles / profile_details / user_roles / notification_preferences
```

- **Server-only code** lives in `src/lib/*.server.ts`, `src/lib/supabase/admin.ts`, `src/lib/api.ts` and `src/app/api/**` (all import `server-only`).
- **Middleware** (`src/middleware.ts`) refreshes the Supabase session cookie and redirects signed-out visitors to `/sign-in`.
- **`src/app/(app)/layout.tsx`** validates the session server-side and routes invited / suspended / deactivated people away before anything renders.
- **Realtime**: Postgres changes (RLS-filtered) for messages, reactions, attachments, notifications, calls and profiles; private broadcast channels `conversation:<id>` (typing) and presence channel `org:presence`, authorized by policies on `realtime.messages`.
- **Logging**: `src/lib/logger.ts` writes one JSON line per event with ids and outcomes only. Keys that look like secrets or content are redacted automatically.

Project layout:

```
src/
  app/               routes: (app)/* signed-in pages, api/* trusted endpoints, auth pages
  components/        ui/ primitives, shell/, conversation/, chat/, teams/, calls/, admin/, providers/
  lib/               supabase clients, env, validation (zod), types, errors, formatting
supabase/
  migrations/        versioned SQL (apply in order)
  templates/         auth email templates (invite, recovery)
  config.toml        local CLI config;  seed.sql  local-only starter departments
scripts/test-db.mjs  migration + RLS test suite (runs in-process Postgres)
```

---

## Data model

| Table | Purpose |
| --- | --- |
| `organization_settings` | Single row: name, allowed email domains, team-creation policy, directory visibility, edit window, delete policy, attachment limit, calls on/off. |
| `departments` | Company departments. |
| `profiles` | One per auth user: name, avatar path, title, department, availability, status message, **employment_status** (`invited`, `active`, `suspended`, `deactivated`), last seen. |
| `profile_details` | Email, phone, work location. Private to the person and admins; others see them only through `search_directory()` according to directory settings. |
| `user_roles` | Organization role: `owner`, `admin`, `manager`, `employee`. Written only by the server. |
| `notification_preferences` | Per-category toggles. |
| `teams`, `team_members` | Teams (public-within-company or private) and membership with `owner`/`member` roles. |
| `channels`, `channel_members` | Channels per team (`standard` or `private`); `channel_members` is used **only** for private channels. |
| `conversations` | Every message stream. `kind` = `direct`, `group` or `channel`. |
| `conversation_members` | Membership for **direct and group** conversations only (role, joined/left). |
| `conversation_user_state` | Per-user `last_read_at`, pinned, muted - for every conversation kind. |
| `messages` | Body, sender, reply reference, mentions, edit/soft-delete state, full-text `search` column. |
| `message_reactions`, `attachments` | Reactions; attachment metadata pointing at private storage objects. |
| `calls`, `call_participants` | Call metadata/history (no media is stored). |
| `notifications` | Per-user notifications with read state. |
| `audit_logs` | Append-only administrative history (no foreign key to people, so history survives). |

**Channels vs chats (one membership source each).** Every message belongs to one `conversations` row. Direct/group access comes from `conversation_members`. Channel access is *derived*: a person can read a channel if they are in the team (`team_members`) and, for private channels, in `channel_members`. Channel conversations never use `conversation_members`, so there is no second, contradictory membership list. Read markers/pins/mutes for all kinds live in `conversation_user_state`.

**Threads.** A reply sets `reply_to_id`. Replies appear in the main stream with a quote, and the thread panel shows the original plus all replies.

---

## Security model

Authorization is enforced in the database (RLS + guard triggers) and in trusted route handlers. Hiding a button in the UI is never the control.

**Permission matrix**

| Capability | Owner | Admin | Manager | Employee |
| --- | :-: | :-: | :-: | :-: |
| Chat, join public teams, start calls | ✓ | ✓ | ✓ | ✓ |
| Create teams | ✓ | ✓ | if policy ≠ admins | if policy = everyone |
| Manage a team's channels/members | all teams | all teams | teams they own | teams they own |
| Edit/delete own messages | ✓ | ✓ | per settings | per settings |
| Remove others' messages (audited) | ✓ | ✓ | – | – |
| Invite, suspend, deactivate | ✓ | managers & employees | – | – |
| Grant admin/owner | ✓ | – | – | – |
| Departments, org settings, audit log | ✓ | ✓ | – | – |

Admins can manage every team's metadata and membership, but **cannot read a conversation they are not a member of**.

Key rules (see `supabase/migrations/20261022000300_policies.sql`):

- Only **active** employees can read organization data. Suspended/deactivated people see only their own profile row.
- Messages are readable by conversation members only; inserts must be your own (`sender_id = auth.uid()`), `kind = 'user'`, and into a conversation you can post to (archived channels are read-only).
- The `messages_guard` trigger enforces: only body edits by the sender within the edit window; soft-delete by sender (if allowed) or by admins (moderation is audited); no changes after deletion.
- `profiles_guard` stops people changing their own employment status, title or department, and stops admins editing others' status/presence fields.
- Roles and employment status change only through `/api/admin/users/*` (service role), which also bans/unbans the Supabase Auth user and writes audit entries. The organization always keeps an active owner.
- Storage: attachments live at `<conversation>/<uploader>/<file>` in a private bucket. Upload requires posting rights and your own folder; download requires an `attachments` row in a conversation you can read (so files of deleted messages become unreadable). Allowed MIME types exclude HTML/SVG/scripts. Signed URLs last 5 minutes (avatars 1 hour).
- Audit log: readable by admins only; inserts only from triggers/server; updates and deletes are blocked by a trigger.
- The email-domain allowlist is enforced by the `on_auth_user_created` trigger, so it applies even to users created in the Supabase dashboard.
- Rate limits: invitations (15/min in-memory + 50/hour from the audit log), call tokens (10/min in-memory + 30 per 10 min from `call_participants`), call invites and resends.
- All `/api` POST/PATCH handlers check `Origin` against the host, validate bodies with zod, and return generic messages for unexpected errors.

---

## Local preview (demo mode, no Supabase needed)

```bash
npm run demo
```

Opens on http://localhost:3000 with the staff accounts listed in `DEMO-LOGINS.md`. That file and `supabase/demo/seed.sql` are generated from the staff CSV and are not committed (they hold personal emails and starting passwords): set `STAFF_PASSWORD` and `ADMIN_PASSWORD` in `.env.local`, then run `node scripts/import-employees.mjs path/to/employees.csv`. Demo mode runs a real PostgreSQL (PGlite, WebAssembly) **inside the browser**, built from the same `supabase/migrations` plus `supabase/demo/*.sql`, so the actual RLS policies, triggers and RPCs decide what each user sees. `src/lib/demo/` emulates the parts of Supabase Auth, Storage and Realtime the app uses, and the admin API rules. Data stays in that browser; calls are unavailable (no media server); no emails are sent. It is enabled only by `NEXT_PUBLIC_DEMO_MODE=true`, which `npm run demo` sets - never set it in a deployment.

---

## Local setup

Prerequisites: Node.js 20.11+ and a Supabase project (hosted, or local via Docker + the Supabase CLI).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `.env.local` (see [Environment variables](#environment-variables)), apply the migrations ([next section](#supabase-project-setup)), then:

```bash
npm run dev
```

Open http://localhost:3000. Without Supabase variables the app shows a **Setup needed** page instead of failing.

**Running Supabase locally (optional, needs Docker):**

```bash
npx supabase start
```

```bash
npx supabase db reset
```

`db reset` applies `supabase/migrations` and the local-only `supabase/seed.sql` (starter departments). Local auth emails are visible in Inbucket at http://localhost:54324.

---

## Supabase project setup

1. **Create a project** at https://supabase.com/dashboard.
2. **Apply migrations** (in order). Either with the CLI:

   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

   ```bash
   npx supabase db push
   ```

   or paste each file from `supabase/migrations/` into the SQL editor, oldest first. The migrations create all tables, triggers, RLS policies, RPCs, both storage buckets (`attachments`, `avatars`) with their policies, the Realtime publication entries and Realtime authorization policies.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled, **turn off "Allow new users to sign up"**, keep "Confirm email" on, and set the minimum password length to 10.
4. **Authentication → URL Configuration**:
   - Site URL: your app URL (e.g. `https://connect.diwakarsolar.com`, or `http://localhost:3000` for development).
   - Redirect URLs: `https://YOUR_APP/auth/callback` and `https://YOUR_APP/auth/confirm` (plus the localhost equivalents for development).
5. **Authentication → Email Templates** (recommended - avoids tokens in URL fragments):
   - *Invite user*: use `supabase/templates/invite.html` (link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/accept-invite`).
   - *Reset password*: use `supabase/templates/recovery.html`.
   The app also works with the default templates (it handles both link styles on `/auth/callback`).
6. **SMTP**: configure a custom SMTP sender (Authentication → Emails → SMTP) for production; the built-in sender is heavily rate-limited.
7. **Realtime → Settings**: keep **"Allow public access" enabled** (the default). The app subscribes to database changes on ordinary channels - each change is still filtered by the subscriber's RLS - and uses *private* channels (authorized by the `realtime.messages` policies in the migrations) for typing indicators and presence.
8. **Create the first owner.** In Authentication → Users, use **Invite user** (or Add user) with your own email, accept the email, then run in the SQL editor:

   ```sql
   select public.bootstrap_owner('you@diwakarsolar.com');
   ```

   This activates the profile and grants the `owner` role. It only works while no owner exists and cannot be called through the API. Everyone else is invited from **Admin → Users**.
9. Optionally set **Admin → Settings → Allowed email domains** (e.g. `diwakarsolar.com`).
10. **Types**: after linking, regenerate the TypeScript types from the live schema with `npm run db:types`.

---

## Call provider (LiveKit) setup

Calls use LiveKit (open source, WebRTC). The rest of the app works without it; call buttons are disabled and pages explain that setup is needed.

1. Create a project at https://cloud.livekit.io (or self-host LiveKit).
2. Copy the **WebSocket URL**, **API key** and **API secret** into `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` on the server (never `NEXT_PUBLIC_`). Locally, `npm run setup:livekit` asks for them (and for `SUPABASE_SERVICE_ROLE_KEY` if missing - the call endpoints need it) and writes `.env.local`; restart the server afterwards.
3. Recommended: add a webhook in LiveKit → Settings → Webhooks pointing to `https://YOUR_APP/api/calls/webhook`. It keeps call history accurate when people close tabs without hanging up (the token endpoint also cleans up stale calls).
4. Do not enable LiveKit Egress/recording - Diwakar Connect does not record calls.

Flow: the browser calls `POST /api/calls/token` → the server checks the caller is active and can post in the conversation (RLS), creates or joins the active `calls` row, and returns a 2-hour LiveKit token scoped to that call's room. `leave`, `end` (starter or admin) and `invite` endpoints manage the rest.

---

## Environment variables

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | yes | Project URL. Inlined at **build** time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | yes | Anon (public) key. Inlined at build time. |
| `NEXT_PUBLIC_SITE_URL` | browser + server | yes | App origin without trailing slash; used for invite links. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | for admin features & calls | Never expose. Without it, admin invite/role/status actions and calls return a "not configured" error. |
| `LIVEKIT_URL` | server only | for calls | e.g. `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` | server only | for calls | |
| `LIVEKIT_API_SECRET` | server only | for calls | |
| `LOG_LEVEL` | server only | no | `debug`, `info` (default), `warn`, `error`. |

`.env.example` contains placeholders only.

---

## Deployment

Any Node.js host that runs Next.js works (Vercel, Netlify, a container).

1. Set all environment variables in the host **before building** (`NEXT_PUBLIC_*` values are compiled into the client bundle).
2. Build and start:

   ```bash
   npm run build
   ```

   ```bash
   npm start
   ```

3. Add the production URL to Supabase Auth Site URL / Redirect URLs and (if used) the LiveKit webhook.
4. Serve over HTTPS - browsers only allow camera/microphone on secure origins.

### Cloudflare Workers (GitHub auto-deploy)

The repo includes the OpenNext adapter (`@opennextjs/cloudflare`), `wrangler.jsonc` and `open-next.config.ts`.

In Cloudflare: **Workers & Pages → Create → Import a repository** → pick this repo, then:

| Setting | Value |
| --- | --- |
| Project name | `diwakar-connect` (must match `name` in `wrangler.jsonc`) |
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |

Under **Advanced settings → Build variables**, add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL` (they are compiled into the browser bundle at build time).
After the first deploy, under **Worker → Settings → Variables and Secrets**, add the runtime secrets `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (and optionally `LOG_LEVEL`).
Then add the `*.workers.dev` URL (or your custom domain) to Supabase Auth → URL Configuration.

Manual deploy from your machine: `npx wrangler login`, then `npm run cf:deploy`. Local Workers preview: `npm run cf:preview`.

Security headers (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, and a `Permissions-Policy` limiting camera/mic/screen to this origin) are set in `next.config.ts`.

---

## Checks and tests

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run test:db
```

```bash
npm run build
```

**Staging end-to-end test.** With a staging project configured in `.env.local` (including `E2E_CONFIRM_PROJECT_REF`), apply migrations with `npm run db:push:staging`, start the app with `npm run dev`, then run `npm run e2e:staging`. It creates labelled E2E users, walks invite → accept → directory → direct chat (realtime delivery, typing, mentions, replies, reactions, unread state, file upload/download, outsider denial) → team and channel → call token/notify/end (or the honest "not configured" refusal) → suspend/reactivate → audit, then deletes its data. Add `-- --keep` to keep the users for clicking through the UI; their random passwords go to the git-ignored `.e2e-credentials.json`.

`npm run check` runs all four. `test:db` applies every migration to an in-process PostgreSQL (PGlite) with minimal stand-ins for Supabase's `auth`, `storage` and `realtime` schemas, then runs 56 checks as different employees: provisioning and the domain allowlist, owner bootstrap, invited/suspended lifecycle, profile and role guards, directory masking, direct/group/channel access, impersonation and system-message blocks, unread counts, read receipts, mention/reply notifications, edit window, reactions, admin moderation + audit, group membership RPCs, team creation policy, public/private teams and channels, last-owner protection, archived read-only channels, storage upload/download scoping, attachment size limits, Realtime topic authorization, server-only call rows, and append-only audit logs. It never connects to a real Supabase project.

---

## Known limitations

- **Not yet run against a live Supabase/LiveKit project in this environment.** The SQL is verified with PGlite plus Supabase stand-ins, and the app builds and type-checks, but do a full pass on a staging project (invite → accept → chat → call) before rollout.
- `src/lib/database.types.ts` is hand-maintained to match the migrations; regenerate it with `npm run db:types` once a project is linked.
- No scheduled meetings or calendar; calls start instantly. Home shows live calls instead of upcoming meetings.
- Desktop alerts work while the app is open in a tab; there is no service-worker push yet.
- Message search is per conversation; global search covers people, group chats and channels.
- Uploaded files are type- and size-checked but not virus-scanned.
- When an admin removes someone else's message, that person's attachment objects become unreadable but remain in storage; schedule a cleanup job for orphaned objects if storage use matters.
- After suspension, a person's existing access token remains technically valid until it expires (default 1 hour), but RLS denies every query and Realtime event immediately because their status is no longer `active`, and the auth ban blocks refresh and new sign-ins.
- In-memory rate limits are per server instance; the durable database-backed limits cover invitations and call tokens.
- People are deactivated rather than hard-deleted; deleting an auth user in the dashboard cascades their profile while keeping message history (sender shows as "Former employee").
- Reactivating someone who never accepted their invitation makes them active without a password; they can use **Forgot password** to set one.
