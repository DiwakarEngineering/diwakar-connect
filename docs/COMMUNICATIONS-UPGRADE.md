# Communications & collaboration upgrade — audit and plan

Scope: the "Diwakar Connect – Communication and Collaboration Feature Upgrade" brief
(Teams-style chat, calls, meetings, screen sharing, presentations, whiteboard, scheduling),
built inside the existing app with its orange design system. This file records what already
exists, what is missing, what needs outside services, and the order of work.

## 1. Existing architecture (reuse, do not replace)

| Layer | What is there | Reuse for |
| --- | --- | --- |
| Hosting | Next.js 15 on Cloudflare Workers (OpenNext), `main` auto-deploys | All UI and `/api/*` routes |
| Auth | Supabase Auth (email/password, invites), `profiles`, `user_roles` (owner/admin/manager/employee), employment status lock-out | Every new feature; no new login |
| Database | Supabase Postgres, RLS on every table, security-definer RPCs, append-only `audit_logs` | New tables via migrations in `supabase/migrations/` |
| Realtime | Supabase Realtime: Postgres changes (RLS-filtered), private broadcast `conversation:<id>` (typing), presence `org:presence` | Messaging, receipts, presence, call signalling, whiteboard and slide sync |
| Storage | Private Supabase bucket, signed URLs, size/type limits from `organization_settings` | Attachments, voice notes, presentations, whiteboard exports |
| Media | LiveKit (SFU, WebRTC, TURN included in LiveKit Cloud), `/api/calls/token|invite|leave|end|webhook`, `calls` + `call_participants` | All calls and meetings (no peer-to-peer) |
| Org data | `departments`, `teams`, `channels`, `team_members`, `channel_members` | Department/project channels — no duplicates |
| UI kit | `src/components/ui/*` (button, dialog, menu, avatar, badge, field, switch, toast, states), Tailwind tokens `brand-*` (#F06A1A / #C84C0A), Inter | All new screens |
| Tests | `npm run test:db` (PGlite + Supabase stand-ins, 56 RLS checks), `npm run e2e:staging` (real staging project), demo mode (PGlite in browser) | Extend for every phase |

Not present today (the brief assumes them): **no dark theme** (no `dark:` styles or theme
setting) and **no calendar**. Both are built as part of this work rather than reused.

## 2. Gap analysis

Legend: ✅ exists · 🟡 partial · ❌ missing · 🔑 needs an outside service/credential

### Phase 1 — Chat and presence
| Feature | Status | Notes |
| --- | --- | --- |
| Real-time 1:1 and group messaging, replies, @mentions, reactions, edit/delete, attachments, typing, per-conversation search | ✅ | |
| Conversation list: search, unread counts, pin, mute | ✅ | |
| Filters Unread / **Chats / Channels**, **Favorites**, **Mentions** view | 🟡 | Add `is_favorite`, channel conversations in list, mentions from `notifications` |
| New conversation "To:" field with people, groups, departments, teams; reuse existing chat | 🟡 | Direct chats already de-duplicate; add group de-dup + group/channel suggestions inline |
| Header: audio/video call, add people, search, shared files, info, more | 🟡 | Add shared-files panel, split audio/video buttons |
| Forward, pin messages | ❌ | `messages.pinned_at`, forward = new message referencing source |
| Voice messages | ❌ | MediaRecorder → existing attachment storage |
| Drag-and-drop attachments | 🟡 | Verify/extend composer |
| Sent / **delivered** / read receipts | 🟡 | "Seen" exists; add `last_delivered_at` |
| GIFs | ❌ 🔑 | Needs a GIF provider API key (GIPHY or Tenor/KLIPY) |
| Stickers | ❌ | Built-in Diwakar sticker set (no outside service) |
| Presence incl. **in a call / in a meeting**, custom status | 🟡 | Availability + status message exist; derive call/meeting state |
| Notification sounds, DND respect | ❌ | Client-side, honours availability |

### Phase 2 — Calls and meetings
| Feature | Status | Notes |
| --- | --- | --- |
| 1:1 / group audio & video via LiveKit, lobby with preview + device selection, mute, camera, screen share, roster, invite, end, reconnect, history | ✅ | |
| Incoming-call popup with ringtone, accept/decline, from any page | 🟡 | Today: toast with "Join". Needs ring state + decline + timeout |
| Outgoing ringing screen, cancel, missed calls | ❌ | `call_invites` table (ringing/accepted/declined/missed) |
| Dark meeting workspace, gallery/speaker layouts, active-speaker orange border, thumbnail strip, name/mic labels, network quality, full screen | 🟡 | Rebuild `call-room.tsx` layout on LiveKit events |
| Raise hand, emoji reactions | ❌ | LiveKit data messages + participant attributes |
| Participant panel: roles, search, invite, copy link, mute one/all, remove, presenter rights, lobby admit/reject | ❌ | LiveKit server API (mute, remove, update permissions) behind role checks |
| Background blur/effects | ❌ | `@livekit/track-processors` (client-side) |
| Recording (authorised, with consent) | ❌ 🔑 | LiveKit Egress + a storage bucket (Cloudflare R2 or S3); policy + consent banner |

### Phase 3 — Sharing and collaboration
| Feature | Status | Notes |
| --- | --- | --- |
| Screen/window/tab share with system audio (browser picker) | 🟡 | Exists; add share drawer, audio toggle, stop/takeover handling |
| Presenter modes (content only, side-by-side, picture-in-picture, full screen) | ❌ | Layout work on top of LiveKit tracks |
| Presentations with synced slides | ❌ 🔑 | PDF works in-browser (pdf.js). PowerPoint needs a conversion service (e.g. Gotenberg/LibreOffice on a container, or CloudConvert API) |
| Collaborative whiteboard + PNG/PDF export | ❌ | Realtime broadcast + persisted strokes |
| Meeting chat (persistent) | 🟡 | Each meeting gets a conversation; reuse conversation components in a side panel |
| Remote control | ❌ | Browsers cannot control another computer. Only offered for in-app content (slides/whiteboard) with presenter approval; full desktop control needs a native agent and is out of scope until one is approved |

### Phase 4 — Scheduling and administration
| Feature | Status | Notes |
| --- | --- | --- |
| Meet now, schedule, calendar, upcoming, join | ❌ | New `meetings` + `meeting_invitees`; calendar page |
| Meeting link, ID, passcode, lobby, attendance | ❌ | |
| External guests | ❌ | Guest join flow with LiveKit token scoped to one meeting, organiser admits |
| Reminders | ❌ | Cloudflare Cron Trigger (Worker) → notifications |
| Transcripts and summaries | ❌ 🔑 | Speech-to-text + LLM service; only when configured |
| Admin: communication permissions, recording policy, meeting logs, storage | 🟡 | Extend existing admin settings/audit |

### Cross-cutting
| Feature | Status | Notes |
| --- | --- | --- |
| Dark theme (system preference + setting) | ❌ | Token-based, light stays default |
| Push notifications when the app is closed | ❌ 🔑 | Web Push (VAPID keys) via `public/sw.js` |
| Responsive drawers on mobile | 🟡 | Shell is responsive; new panels follow the same pattern |

## 3. Outside services and configuration needed

| Need | For | Options |
| --- | --- | --- |
| LiveKit URL/key/secret | All calls (already supported) | Existing LiveKit Cloud project |
| LiveKit Egress + R2/S3 bucket | Recording | LiveKit Cloud Egress, Cloudflare R2 |
| GIF API key | GIFs | GIPHY or KLIPY |
| Document conversion | PowerPoint/Word/Excel previews and slides | Gotenberg (self-hosted), CloudConvert |
| VAPID key pair | Push when app closed | Generated once, stored as a Worker secret |
| Speech-to-text / summary | Transcripts, summaries | Deepgram/AssemblyAI + an LLM |

Anything without its credentials shows a clear "not configured" state — never a fake result.

## 4. How each phase is verified

- `npm run typecheck`, `npm run lint`, `npm run test:db` (new RLS checks for every table), OpenNext build.
- Multi-account browser tests with Playwright: two or more signed-in employees in separate
  browser contexts, Chromium's fake camera/microphone for real LiveKit media.
- These need a **staging** Supabase project and LiveKit keys available to the test runner.

## 5. Progress

### Phase 1 — Chat and presence (first delivery)

Migration: `supabase/migrations/20261117000100_chat_workspace.sql` (additive). **Apply it to the
Supabase project before deploying the app**: the new screens call its functions, and the current
app keeps working once it is applied.

Delivered and tested (database checks in `npm run test:db`; browser walk-through in demo mode
with separate employee accounts):

- Chat list: Unread / Chats / Channels filters, Mentions view, Favorites and Recent sections,
  team channels listed with team names, favourite / pin / mute / mark-as-read per conversation.
- New chat (`/chat/new`): "To:" search across employees (photo, presence, title, department),
  existing group chats, team channels and departments (adds the department's active members);
  reuses an existing direct chat, or a group with exactly the same members, instead of duplicating.
- Header: favourite, add people (from a 1:1 chat to a group, de-duplicated), shared files,
  pinned messages, audio/video call, search, members, more options.
- Messages: forward (files are copied into the target conversation's storage, so its access rules
  apply), pin for everyone (live), built-in Diwakar sticker set, voice messages (up to 5 minutes,
  recorded in the browser, stored as attachments), sent / delivered / read ticks, PDF / image /
  audio / video preview in the browser.
- Presence: "In a call" shown automatically while connected to a call (clears on leave or close);
  Do not disturb takes priority.
- Notifications: sound for new direct/group messages and mentions (per-device switch in Settings),
  desktop alert for new messages while the tab is in the background; muted chats and
  Do not disturb stay silent.

Still to do in Phase 1: GIFs (needs a GIF provider key), Word/Excel/PowerPoint previews (needs a
conversion service), dark theme.

### Phase 2 — Calling and meeting workspace (first delivery)

Migration: `supabase/migrations/20261119000100_call_ringing.sql` (additive; apply before deploying).

Delivered:

- **Ringing**: `call_invites` (ringing → accepted / declined / missed), created by the database when a
  direct/group call starts or someone is invited. Incoming-call popup on every page (caller photo,
  name, audio/video, Accept, Decline, ringtone, 45 s timeout → missed call). Do not disturb: no popup.
- **Outgoing**: "Calling …" screen with ringback tone and Cancel; shows Declined / No answer.
- **Missed calls**: notification "Missed video call from …" when a ring times out or the call ends
  unanswered.
- **Meeting workspace**: dark layout with a top toolbar (participants, chat, raise hand, reactions,
  more: gallery/speaker view, device settings, full screen, invite, end for everyone; camera,
  microphone, share; red Leave with "end for everyone"). Gallery grid that resizes with the number of
  people; speaker view with thumbnail strip; orange active-speaker border; name, microphone and
  network-quality marks; avatar when the camera is off; presenting banner with Stop sharing.
- **Participants panel**: count, search, invite, copy link, organizer / presenter / attendee, camera
  and microphone state, raised hands, invited people with Ringing / Declined / No answer; organizer
  and admins can mute one, mute all and remove (`/api/calls/moderate`, enforced by LiveKit, audit
  logged).
- **Meeting chat**: the call's own conversation beside the video; history stays in the chat.
- Mobile app 1.2.0: Decline and ring timeout are reported to the caller.

Tested: database rules (`test:db`, 66 checks); a real two-person call through a local LiveKit
server with fake camera/microphone (live video both ways, raise hand, reactions, participants
panel, speaker view, meeting chat, screen share start/stop, network drop → "Reconnecting" →
recovered, leave). Not yet tested end-to-end on the live project: ringing popup / outgoing screen
(they need the live database) and moderation (needs the real LiveKit server API).

Not in this delivery: background blur/effects, recording (needs LiveKit Egress + storage),
lobby/admit, presenter modes, slides, whiteboard, scheduling (phases 3–4).
