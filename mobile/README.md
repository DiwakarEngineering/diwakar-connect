# Diwakar Connect — mobile app (Android and iPhone)

A native app built with **Expo / React Native**: one codebase compiled to a real Android app and a
real iPhone app. It is not a website wrapper. It uses the **same accounts, chats, teams and calls**
as the website (same Supabase project, same LiveKit call service), so phone and browser users talk
to each other directly.

## What it does

| Area | Features |
| --- | --- |
| Sign in | Work email + password (same accounts as the website), forgot password via the website, suspended / deactivated / not-yet-activated accounts are blocked, session kept in the phone's secure keychain/keystore. |
| Chat | Chats and team channels, All / Unread / Chats / Channels filters, search, unread badges, presence dots, long-press to favourite / pin / mute / mark read. |
| Conversation | Real-time messages, replies, reactions, edit / delete (organization rules apply), pin for everyone, stickers, photos / videos / camera / documents, voice messages, typing indicator, sent / delivered / read ticks, offline catch-up after reconnecting. |
| New chat | Pick one colleague (direct chat) or several (group); existing chats are reused, not duplicated. |
| Calls | Real audio and video calls through LiveKit (WebRTC): mute, camera on/off, switch camera, speaker / earpiece, live participant tiles with orange active-speaker border, network-quality marks, automatic reconnection, call duration. Ringing screen with Accept / Decline and ringtone for incoming calls while the app is open; call history with missed calls and "Join" for live calls; "In a call" presence. |
| Meetings (1.3.0) | Calls tab → Meetings: the next two weeks grouped by day with Live badges and Join (from 15 minutes before); Meet now; Schedule meeting (title, day, start time, length, invitees, agenda, external guests if the organization allows them); meeting page with joining information, Share / Copy invitation, Accept / Tentative / Decline, invitees' responses, lobby Admit / Reject and Cancel for the organizer; Join with meeting ID + passcode (lobby until admitted). Meeting links (`…/meet/<ID>`) open in the app on Android. |
| In the meeting (1.3.0) | Raise hand, reactions, participants list (organizer, presenter, guests, camera / microphone, raised hands, who is still ringing), organizer: mute, mute all, remove, lobby admit / reject with a "waiting in the lobby" banner; meeting chat; screen shares from computers shown large with the people in a strip; the shared whiteboard (live, late-join sync, draw with a pen in six colours, undo); slides being presented (name, current slide, open the file). |
| Teams / People / Me | Team channels with unread counts; company directory (tap to chat); availability, status message, notifications, sign out. |

Not yet: push notifications when the app is closed (needs Firebase + Apple Push keys), sharing
the phone's own screen or presenting slides from the phone, editing a meeting's time or invitees
(done on the website). Meeting links open in the app on Android; on iPhone they open the website,
or enter the meeting ID with "Join with ID".

## Configuration

Public settings live in `app.json` → `expo.extra` (the same public values the website sends to
every browser): `supabaseUrl`, `supabaseAnonKey`, `siteUrl`. Call tokens come from the website's
`/api/calls/token` endpoint, which accepts the app's sign-in token.

App identity: package / bundle id `com.diwakarsolar.connect`, version in `app.json`
(`version`, `android.versionCode`, `ios.buildNumber` — raise them for every store release).

## Develop

```bash
cd mobile && npm install
```

```bash
npm run typecheck && npm run lint
```

```bash
npx expo run:android
```

Calls and other native modules need a development build (`expo run:android` / `expo run:ios`),
not Expo Go. `npm run sync-shared` copies the website's database types and formatting helpers.

## Build for Android (no Mac needed)

Needs JDK 17 and the Android SDK. Sign with the **same upload key every time**:

```bash
ANDROID_HOME=~/Android/Sdk ANDROID_KEYSTORE=/path/signing.keystore ANDROID_KEY_ALIAS=diwakar-connect ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_PASSWORD=... npm run build:android
```

Outputs: `dist-android/diwakar-connect-<version>.aab` (Google Play) and `.apk` (install directly).

## Build for iPhone

iPhone apps must be compiled on a Mac with Xcode, or with Expo's cloud build service (EAS), which
needs no Mac. You need an **Apple Developer Program** membership (US$99/year).

1. Create a free account at https://expo.dev.
2. In this folder:

   ```bash
   npx eas-cli@latest login
   ```

   ```bash
   npx eas-cli@latest build --platform ios --profile production
   ```

   EAS asks for your Apple ID, creates the certificates and provisioning profile, and builds the app
   in the cloud (about 15–25 minutes).
3. Send it to App Store Connect / TestFlight:

   ```bash
   npx eas-cli@latest submit --platform ios
   ```

4. In App Store Connect, add testers in **TestFlight** (staff install the TestFlight app and get
   the build by email), or publish privately to your company with **Apple Business Manager**
   (custom app) or publicly on the App Store after review.

Android can also be built on EAS (`--platform android`) if you prefer the cloud.
