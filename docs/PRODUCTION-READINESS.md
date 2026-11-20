# Communications upgrade — production readiness

This is the phase 5 sign-off for the communications and collaboration upgrade (see
`docs/COMMUNICATIONS-UPGRADE.md` for what each phase delivered). It records what was verified,
how it was verified, what must be configured before go-live, and what can only be confirmed on
the live project.

## 1. How things were verified

| Method | What it proves | Limits |
| --- | --- | --- |
| `npm run test:db` (74 checks) | The real migrations run on PostgreSQL (PGlite); RLS policies, triggers and RPCs allow and deny the right people, including signed-out callers. | Supabase Realtime and Storage servers are not part of it. |
| Demo mode (`npm run demo`) | The real UI on the real schema and RLS, with Supabase Auth, Storage and Realtime emulated in the browser. Accounts take turns in one browser. | Messages between two devices through Supabase Realtime are not exercised. |
| Demo mode + local LiveKit (`livekit-server --dev`) | Real WebRTC calls between separate browser sessions, with Chromium's fake camera and microphone. | Chromium only; one machine; LiveKit's server API (moderation) differs from LiveKit Cloud. |
| Responsive sweep | 14 app pages, the call room with its participants and chat panels, and the guest link page at iPhone 13, iPad Mini and 1366 px desktop sizes: no sideways scrolling and no controls cut off. | Visual review of the phone screenshots, not every state of every page. |
| Build checks | `typecheck`, `lint`, OpenNext build. | — |

## 2. Acceptance criteria

Status key: **Verified**: tested end to end here. **Verified (rules)**: logic and access rules
tested; the live service path still needs the check in section 4. **Live check**: needs the live
project or services this environment cannot reach.

| # | Criterion | Status | Evidence / what remains |
| --- | --- | --- | --- |
| 1 | Two accounts exchange messages in real time | Verified (rules) | Sending, receipts (sent / delivered / read), pins, forwards, and member-only access tested in `test:db` and demo mode. Two devices on live Supabase Realtime: section 4, step 1. |
| 2 | Group conversation works | Verified (rules) | Group creation (reuses an identical group), add people, channels, mentions: `test:db` and demo mode. Live: section 4, step 2. |
| 3 | Presence updates | Verified (rules) | Available / Busy / Do not disturb / Away, and automatic "In a call" while connected, shown in demo mode. Two devices: section 4, step 3. |
| 4 | Audio and video calls between accounts | Verified | Two signed-in users in separate browser sessions, live video both ways, through local LiveKit. |
| 5 | Group video uses live media | Verified | 6 participants (3 signed-in users + 3 extra publishers): every user received 6 live videos; gallery, speaker view and phone layouts had no overlapping tiles. Simulcast/dynacast and adaptive stream are on for larger meetings. |
| 6 | Incoming calls can be accepted or declined | Verified (rules) | `call_invites` and `respond_to_call` (ringing → accepted / declined / missed, missed-call notification) tested in `test:db`. The popup needs the live database: section 4, step 4. |
| 7 | Screen share starts and stops | Verified | Chromium: share, side-by-side / content-only / picture-in-picture, stop from the app and from the browser bar. Firefox and Safari: section 4, step 9. |
| 8 | Presentation sync | Verified | PDF slides synced for everyone including late joiners; control request → allow → take back. PowerPoint / Word / Excel need `GOTENBERG_URL` (section 3). |
| 9 | Whiteboard updates in real time | Verified | Strokes both ways, undo, clear permissions, late-joiner sync, PNG/PDF export, save to chat. |
| 10 | Meeting chat works throughout the call | Verified | The meeting chat panel during calls (desktop and phone). Live delivery between devices: as criterion 1. |
| 11 | Meeting links let authorized users join | Verified (rules) | Invitees join directly; other employees: wrong passcode rejected → lobby → organizer admits. External guests need the service key and the live project: section 4, step 6. |
| 12 | File upload, preview and download | Verified (rules) | Upload, image / PDF / audio / video preview, download, forward copies with the target chat's access rules: demo mode; storage RLS in `test:db`. Live storage bucket: section 4, step 5. |
| 13 | Unauthorized users can't access private content | Verified (rules) | 74 database checks including signed-out denial; guest tokens are camera/microphone only (no data, no chat, no metadata), expire after 5 minutes and are re-checked by the LiveKit webhook. Probes of the live site were not possible from here: section 4, step 7. |
| 14 | Network disconnections are handled | Verified | 30 s signalling outage: "Network interrupted. Reconnecting…" shown, call recovered about 9 s after the network returned. Media-server crash (`kill -9`) and restart: every client rejoined automatically with all live videos within 12–18 s (4 runs), no "call ended" screen. |
| 15 | Existing functionality is unaffected | Verified (rules) | All migrations are additive; typecheck, lint, `test:db` and the OpenNext build pass; the responsive sweep covered the existing pages too. Live smoke test: section 4, step 8. |

## 3. Go-live configuration checklist

1. **Database migrations, in this order** (Supabase SQL editor or `supabase db push`), before
   deploying the app:
   1. `supabase/migrations/20261117000100_chat_workspace.sql`
   2. `supabase/migrations/20261119000100_call_ringing.sql`
   3. `supabase/migrations/20261120000100_meetings.sql`
2. **pg_cron** (meeting reminders): enable it under Database → Extensions *before* running the
   meetings migration. If it was enabled afterwards, run the migration's final `do $$ … $$` block
   again to schedule the job `diwakar-meeting-reminders`.
3. **Cloudflare Worker variables / secrets**:
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: calls, moderation, guest tokens.
   - `SUPABASE_SERVICE_ROLE_KEY`: guest meetings, the webhook and admin actions.
   - Optional: `GOTENBERG_URL` and `GOTENBERG_BASIC_AUTH` (`user:password`) for Office documents.
4. **LiveKit webhook**: in the LiveKit Cloud project, add
   `https://connect.diwakarsolar.com/api/calls/webhook`. It is signed with the API key above. It
   keeps call history accurate when people close the tab, and removes guests who are no longer
   admitted.
5. **Admin settings** (Admin → Settings → Meetings): who can schedule meetings; whether external
   guests are allowed at all (off by default).
6. **Networks**: LiveKit Cloud provides TURN over TLS, so calls work behind office firewalls. With
   self-hosted LiveKit, configure TURN and use a version that enforces `revokeTokenTs` (see risks).
7. **Plan limits**: check the Supabase plan's concurrent Realtime connections (every open tab and
   app holds one) and the LiveKit plan's participant minutes against expected use.
8. **Mobile app**: install `diwakar-connect-1.2.0.apk` on Android; iPhone builds go through EAS
   (`mobile/README.md`).

## 4. Live verification script (about 30 minutes, two people)

Use two employee accounts on two devices (for example a laptop and a phone), after section 3.

1. **Chat**: A sends B a direct message; it appears for B without refreshing; ticks go sent →
   delivered → read when B opens it; B replies.
2. **Group**: A creates a group with B and a third person; all three see messages live; add a
   fourth person from the header.
3. **Presence**: B sets Do not disturb; A sees it within a few seconds. B joins a call; A sees
   "In a call".
4. **Ringing**: A video-calls B: B gets the popup with ringtone; Decline → A sees "Declined".
   Call again, B accepts: video both ways. Call a third time and let it ring 45 s: missed-call
   notification.
5. **Files**: send a photo, a PDF and a voice message; preview and download each on the other device.
6. **Meeting link and guest**: schedule a meeting, enable guests, open the link in a private window
   signed out, ask to join with the passcode, admit from the call, then remove the guest. The guest
   must not be able to come back without being admitted again.
7. **Signed-out access**: in a private window, open `/chat`, `/admin` and a `/meetings/<id>` link:
   each must go to sign-in. A guest who opens `/chat/<id>` must not see messages.
8. **Smoke test of the existing app**: sign in, Home, People, Teams, Notifications, Settings,
   Admin → Users. Nothing should look different apart from the new features.
9. **Other browsers**: one call with screen share from Firefox and from Safari (Mac or iPhone).
10. **Moderation on LiveKit Cloud**: organizer mutes one person, mutes all, stops someone's
    presenting and removes a participant; check the audit log.

## 5. Known risks and limits

- **Rate limits are per Worker instance** (in memory). They slow down guessing of guest passcodes,
  but they are not a global limit. Adding a Cloudflare rate-limiting rule for
  `/api/meetings/guest/join` gives a hard limit.
- **Removing someone from a call**: the app sets `revokeTokenTs` so their old token stops working.
  LiveKit Cloud enforces this; open-source LiveKit 1.13 does not. For guests the webhook removes them
  if they reconnect, and guest tokens expire after 5 minutes. An employee removed from a call can
  still rejoin while they remain a member of the conversation. That is by design: removing someone
  from a call does not remove them from the chat.
- **Browsers**: tested in Chromium (Chrome / Edge). Firefox and Safari still need the live check
  (step 9). "Include computer sound" only works in Chrome and Edge.
- **Load**: a 6-person call was tested on one machine. Bigger meetings rely on LiveKit's SFU and
  simulcast. Each person's upload stays the same as the meeting grows; download and CPU grow with
  the number of visible videos.
- **Roster after a media-server restart**: livekit-client can add a returning participant without
  firing an event, so the call room re-checks the participant list every 4 seconds while in a call.
- **Not built (needs outside services, not simulated)**: recording (LiveKit Egress + storage),
  transcripts and summaries (speech-to-text), GIFs (GIF provider key), push notifications when the
  app is closed (VAPID keys), background blur, dark theme.
