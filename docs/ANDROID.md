# Publishing Diwakar Connect on Google Play (Android)

The Android app is a **Trusted Web Activity (TWA)**: a small Play Store app that opens
<https://diwakar-connect.engineering-aeb.workers.dev> full-screen, without a browser bar.
It runs the same website, so **every website deploy updates the app instantly** — there is
no separate Android code to maintain.

The website already provides everything a TWA needs:

| URL | Purpose |
| --- | --- |
| `/manifest.webmanifest` | Web app manifest (name, colours, icons, start URL) |
| `/icons/icon-192.png`, `/icons/icon-512.png` | App icons |
| `/icons/maskable-192.png`, `/icons/maskable-512.png` | Maskable (adaptive) Android icons |
| `/icons/apple-touch-icon.png` | iPhone home-screen icon |
| `/sw.js` | Service worker (shows an offline page only; never caches app data) |
| `/offline` | Page shown when the device has no connection |
| `/.well-known/assetlinks.json` | Digital Asset Links: proves the app and the site belong together |

All of these are public (no sign-in needed).

---

## 1. Build the Android app with PWABuilder

1. Open <https://www.pwabuilder.com>, enter `https://diwakar-connect.engineering-aeb.workers.dev` and click **Start**.
2. Click **Package for stores** → **Android** → **Generate Package** (open **Options** first).
3. Fill in:

   | Option | Value |
   | --- | --- |
   | Package ID | `com.diwakarsolar.connect` |
   | App name / Short name | `Diwakar Connect` |
   | Version | `1.0.0` |
   | Version code | `1` |
   | Theme colour | `#F06A1A` |
   | Background colour | `#FFFFFF` |
   | Signing key | **Create new** (fill in your organisation's details) |

4. Download the zip. It contains:
   - `*.aab` — the bundle you upload to Google Play
   - `*.apk` — for installing directly on a phone to test
   - `assetlinks.json` — contains the SHA-256 fingerprint of your signing key
   - `signing.keystore` and `signing-key-info.txt` — **your signing key and its passwords**

> **Back up `signing.keystore` and `signing-key-info.txt` somewhere safe (e.g. a password
> manager or company vault).** You need them for every future update. If they are lost you
> cannot update the app under the same listing.

## 2. Link the app to the website (Cloudflare)

In Cloudflare: **Workers & Pages → diwakar-connect → Settings → Variables and Secrets**
(the runtime variables, **not** the Builds variables), add two **Text** variables:

| Name | Value |
| --- | --- |
| `ANDROID_PACKAGE_NAME` | `com.diwakarsolar.connect` |
| `ANDROID_SHA256_FINGERPRINTS` | the `sha256_cert_fingerprints` value from the zip's `assetlinks.json` (looks like `AB:CD:12:…`) |

Click **Deploy**, then open
<https://diwakar-connect.engineering-aeb.workers.dev/.well-known/assetlinks.json>.
It should show your package name and fingerprint (an empty `[]` means the variables are not set yet).

## 3. Test on a phone

Copy the `.apk` to an Android phone and install it (allow "install unknown apps" when asked).
Open it and sign in.

- **No address bar at the top** → the app and site are linked correctly.
- **An address bar is visible** → the fingerprint or package name doesn't match. Re-check step 2
  (it can take a few minutes for Android to re-check; uninstall and reinstall the app).

## 4. Publish on Google Play

1. Create a **Google Play Console** account at <https://play.google.com/console> (one-time US$25 fee).
   Choose an **Organization** account: new *personal* accounts must first run a closed test
   with at least 12 testers for 14 days before they can publish to production.
2. **Create app**: name "Diwakar Connect", type *App*, *Free*.
3. **Play App Signing**: accept it when you first upload. Google then re-signs the app with
   its own key. Copy that key's SHA-256 fingerprint from **Test and release → Setup → App
   signing** (the *App signing key certificate*) and add it to `ANDROID_SHA256_FINGERPRINTS`
   in Cloudflare, comma-separated after your upload key's fingerprint:

   ```
   AB:CD:…:12,98:76:…:EF
   ```

   Deploy again. Without this, the app installed from the Play Store shows an address bar.
4. **Store listing**:
   - App icon: 512×512 — use `public/icons/icon-512.png`
   - Feature graphic: 1024×500 (make one in Canva or similar)
   - Phone screenshots: at least 2 (take them from the test app)
   - Short and full description
5. **App content** (all required before publishing):
   - **Privacy policy URL** (required — host a privacy policy page and link it)
   - **Data safety** form (the app collects name, email, messages, and uses camera/microphone for calls)
   - **Content rating** questionnaire
   - **Target audience** (adults / 18+)
   - **App access**: because the app needs a sign-in, give reviewers a **test account**
     (email and password of a working employee account with limited data)
6. Upload the `.aab` to a release track and submit for review.

### Team-only options (not public on the Play Store)

- **Internal testing**: up to 100 testers added by email. No full review needed; fastest way to
  get the app to staff. Testers install from an opt-in link.
- **Private app (Managed Google Play)**: if the company uses Google Workspace, publish the app
  privately to your organisation from the Play Console (**Advanced settings → Managed Google Play**).
  Only your organisation's accounts can see and install it.

## Updating the app

- **Website changes need no new build.** Deploy the website as usual; the app shows the new
  version immediately.
- A **new build** is only needed to change the app's name, icon, package ID or other manifest
  settings baked into the app. Build again in PWABuilder with **Use mine** for the signing key
  (upload your saved `signing.keystore`), the **same package ID**, and a **higher version code**
  (e.g. `2`), then upload the new `.aab` to the Play Console.

## Notes

- On the first call, Android asks for **camera and microphone** permission; staff must allow it
  for calls to work.
- With no connection the app shows a friendly offline page with a **Try again** button.
- **iPhone**: there is no Play Store build. Staff open the site in **Safari → Share → Add to Home
  Screen**, which installs it with its own icon and opens it full-screen.
