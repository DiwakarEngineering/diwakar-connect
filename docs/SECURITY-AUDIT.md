# Diwakar Connect — Security audit and hardening

**Date:** 2026-11-28
**Scope:** web app (Next.js 15 on Cloudflare Workers via OpenNext), Supabase database, auth and storage, LiveKit calls.
**Base commit:** `45e3bc8` on `main`.

This report separates what was **verified** (tested, with results) from what is **recommended** (settings and follow-ups that need a person with access to Supabase or Cloudflare).

---

## 1. Vulnerabilities found

| Severity | Finding | Where | Status |
| --- | --- | --- | --- |
| **Critical** | A stranger could self-register and become an active employee. Supabase public sign-up is enabled on the live project and no allowed email domains are set. Every new auth user gets an `invited` profile, and `activate_my_account()` turned *any* `invited` profile into `active`. | `public.activate_my_account()` (Supabase) | **Fixed in code** by `supabase/migrations/20261128000100_require_invitation_to_activate.sql` (activation now needs `auth.users.invited_at`, set only by admin invitations). **The migration must be applied, and sign-up turned off** (section 9). |
| Medium | Open redirect after sign-in: `/%09/evil.com` (browsers drop the tab, giving `//evil.com`) and `/..//evil.com` (normalizes to `//evil.com`) passed `safeNextPath`. | `src/lib/validation.ts` | Fixed |
| Medium | No Content-Security-Policy, so an injected script would run with full access. | all pages | Fixed (per-request nonce CSP) |
| Medium | Vulnerable dependencies (Next.js, Zod, PostCSS). | `package.json` | Already fixed on `main` before this audit: Next 15.5.29, Zod 4, PostCSS 8.5.31; `npm audit` reports 0 production vulnerabilities |
| Low | No request body size limit on JSON endpoints. | `src/lib/api.ts` | Fixed (64 KB cap) |
| Low | API responses had no `Cache-Control`, so private JSON could be stored by caches. | `/api/*` | Fixed (`no-store`) |
| Low | No HSTS or Cross-Origin-Opener-Policy. | response headers | Fixed |
| Low | The CSRF check skipped requests without an `Origin` header. | `assertSameOrigin` in `src/lib/api.ts` | Fixed (also rejects `Sec-Fetch-Site: cross-site`) |
| Info | Secrets (Supabase service role key, LiveKit key/secret) were shared in chat during setup. | operational | **Rotate** (section 9, step 5) |

## 2. Already strong (verified)

- **Row-level security** is enabled on every table; the `anon` role has no table access; every `security definer` function pins `search_path = ''`.
- **Mass assignment** is blocked: message, profile and role policies plus guard triggers stop users from changing columns they don't own (role, employment status, sender, timestamps).
- **Admin APIs** check the caller's role server-side before using the service client.
- **Guest meeting endpoint:** 8 attempts per 10 minutes per IP, the same error for every failure (IDs can't be probed), organizer must admit guests, guest secrets stored hashed.
- **Call APIs** authorize through the user's RLS-bound Supabase client, not the service key.
- **Storage** buckets are private, files are served through short-lived signed URLs, with size limits and a MIME allowlist that excludes HTML and SVG.
- **Message rendering** is plain text; only `http(s)` links are turned into anchors.
- **Logging** goes through a redacting logger (no tokens or secrets in logs).
- **No secrets** in the repository or its git history; no production source maps are published.
- **Live outsider probes** against the production project were all denied: public file URLs, bucket listing, reading the `messages` table, calling `bootstrap_owner`.

## 3. Files changed and why

| File | Change |
| --- | --- |
| `supabase/migrations/20261128000100_require_invitation_to_activate.sql` (new) | `activate_my_account()` requires `auth.users.invited_at is not null`. |
| `scripts/test-db.mjs` | Test helper can create invited or self-registered users; new regression test "self-registered (never invited) person cannot activate themselves". |
| `supabase/demo/stubs.sql` | `invited_at` column in the `auth.users` stub used by tests and demo mode. |
| `src/lib/validation.ts` | `safeNextPath` rejects control characters and backslashes, resolves the path and requires it to stay on this origin; `z.config({ jitless: true })` so Zod 4 doesn't probe `eval` under the CSP. |
| `src/lib/security-headers.ts` (new) | Builds the CSP with a fresh nonce per request; `CSP_MODE` runtime variable (`enforce` / `report-only` / `off`). |
| `src/middleware.ts` | Generates the nonce and CSP for each request. |
| `src/lib/supabase/middleware.ts` | Passes the nonce to Next.js (`x-nonce`), sets the CSP on the response, `Cache-Control: no-store` on `/api/*`. |
| `next.config.ts` | Adds `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `X-Permitted-Cross-Domain-Policies`. |
| `public/_headers` (new) | Security headers for static files served directly by Cloudflare. |
| `src/lib/api.ts` | 64 KB JSON body cap; reject `Sec-Fetch-Site: cross-site` on state-changing requests. |

## 4. Controls and what each prevents

| Control | Prevents |
| --- | --- |
| Invitation-only activation | Strangers signing up through the public Supabase API and joining as employees |
| Redirect validation (`safeNextPath`) | Phishing that sends people to a look-alike site right after a real sign-in |
| Content-Security-Policy | Injected `<script>` tags and inline event handlers (XSS), scripts from other sites, sending data to attacker hosts, plugins (`object-src 'none'`), `<base>` hijacking, forms posting elsewhere, framing by other sites (clickjacking) |
| HSTS | Downgrade from HTTPS to HTTP on hostile networks |
| Cross-Origin-Opener-Policy | Cross-window attacks from pages that open or are opened by the app |
| `Cache-Control: no-store` on APIs | Private JSON being kept in browser, proxy or CDN caches |
| `Sec-Fetch-Site` check | Cross-site request forgery, including requests without an `Origin` header |
| JSON body cap | Memory exhaustion from oversized payloads |

## 5. Tests executed

Run on `main` at `45e3bc8` with these changes applied (this session):

| Check | Result |
| --- | --- |
| `npm ci` | OK |
| `npm run typecheck` | Pass |
| `npm run lint` (`--max-warnings=0`) | Pass |
| `npm run test:db` | **76 passed, 0 failed**, including "self-registered (never invited) person cannot activate themselves" |
| `npx opennextjs-cloudflare build` | Pass |
| `safeNextPath` against `/\t/evil.com`, `/%09/evil.com` (decoded), `/..//evil.com`, `//evil.com`, `/\evil.com`, `https://evil.com` | All return `/`; `/chat?x=1#a` and `/admin/users` are kept |
| `npx wrangler dev` (dummy Supabase values): `/sign-in` headers | `content-security-policy` present with nonce, `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`, `upgrade-insecure-requests`; HSTS, COOP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `X-Permitted-Cross-Domain-Policies: none` present |
| `<script>` tags on `/sign-in` carrying the response's nonce | 18 of 18 |
| `POST /api/meetings/guest/join` with a 70 KB body | 400 "Request body is too large.", `Cache-Control: no-store` |
| `POST /api/meetings/guest/join` with invalid JSON | 400 "Request body must be JSON." |
| `POST /api/calls/end` with `Sec-Fetch-Site: cross-site` | 403 "Cross-origin request blocked." (with `same-origin`: 401 as expected, no session) |
| Chromium under enforced CSP: `/sign-in`, `/forgot-password`, `/accept-invite`, `/reset-password`, `/account-disabled` | All 200, hydrated, **0 CSP violations**, 0 page errors |
| Injected `<img src=x onerror=…>` | Blocked (handler did not run) |
| `fetch("https://attacker.example/…")` from the page | Blocked by `connect-src` |

The earlier session (same changes, same base commit) also verified: `/meet/<code>` loads with 0 CSP violations, and the sign-in form reaches Supabase under the enforced CSP.

## 6. Build status

TypeScript, ESLint and the Cloudflare (OpenNext) build all pass. No new dependencies were added.

## 7. Features verified

- **Verified:** public pages (sign-in, forgot password, accept invite, reset password, account disabled, guest meeting page) render and hydrate under the enforced CSP; the sign-in form talks to Supabase.
- **Not tested signed-in:** chat (Realtime websockets), calls (LiveKit), attachments and slide previews (signed URLs, pdf.js worker). The CSP allows the Supabase project's `https`/`wss` origin and `*.livekit.cloud`, which is what these features use. **If anything misbehaves after deploy, set `CSP_MODE=report-only`** in Cloudflare runtime variables (takes effect without a rebuild), reproduce, and read the violations in the browser console.

## 8. Remaining risks

- `'strict-dynamic'` trusts scripts created by already-running trusted code; the CSP is a second line of defense behind React's escaping, not a replacement for it.
- `style-src 'unsafe-inline'` is needed for React style attributes and Next.js font CSS; CSS injection is still possible in principle (low impact without script execution).
- Supabase session cookies are readable by JavaScript by design (the browser client needs them); an XSS that got past the CSP could read the session.
- Rate limits are in memory per Worker instance, so a distributed attacker gets more attempts than the nominal limit.
- pdf.js slide previews were not exercised signed-in under the CSP.
- Accounts that already self-registered before the fix are **not** removed automatically; their status stays whatever it is now (see section 9, step 4).

## 9. Manual settings (required)

1. **Supabase → Authentication → Sign In / Providers → Email → turn OFF "Allow new users to sign up".** Invitations keep working.
2. **Admin → Settings → Allowed email domains:** set the company domain(s), e.g. `diwakarsolar.com`.
3. **Apply the migration:** paste `supabase/migrations/20261128000100_require_invitation_to_activate.sql` into the Supabase SQL Editor and run it (or `npx supabase db push`). Cloudflare deploys do not run database migrations.
4. **Admin → Users:** deactivate anyone who was not invited by an administrator.
5. **Rotate secrets, in this order:**
   1. Create a new Supabase secret key and a new LiveKit API key/secret.
   2. Put them in Cloudflare runtime secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) and deploy.
   3. Only then delete the old keys and disable the Supabase legacy JWT keys. Doing this first breaks admin features (invites, user management) until the new keys are in place.
6. **Supabase Auth:** minimum password length 10 or more, review rate limits, keep "Confirm email" on.
7. **Cloudflare:** keep secrets as type **Secret** (not Text) in the Worker's runtime variables.

## 10. Rollback

- **CSP only:** set `CSP_MODE=report-only` (log, don't block) or `CSP_MODE=off` in Cloudflare runtime variables. No rebuild needed.
- **All code changes:** `git revert` the hardening commit and push to `main`.
- **Database:** re-run the previous `activate_my_account()` body from `supabase/migrations/20261022000200_functions.sql`. **Not recommended while public sign-up is enabled**, as it reopens the critical issue.
