"use client";

/**
 * "Remember me" on the sign-in page. Unticked, the session ends when the browser is closed:
 * a marker in localStorage says "session only", and a session cookie (no expiry, so the
 * browser drops it on close) says "this browser session is still open". If the app starts
 * with the marker but without the cookie, the person is signed out.
 */
const SESSION_ONLY = "dc-session-only";
const ALIVE = "dc-alive";

export function saveRememberChoice(remember: boolean) {
  try {
    if (remember) localStorage.removeItem(SESSION_ONLY);
    else localStorage.setItem(SESSION_ONLY, "1");
  } catch {
    /* storage blocked: the session simply persists */
  }
  document.cookie = `${ALIVE}=1; path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

/** True when "Remember me" was off and the browser has been closed since signing in. */
export function browserSessionEnded(): boolean {
  try {
    if (localStorage.getItem(SESSION_ONLY) !== "1") return false;
  } catch {
    return false;
  }
  return !document.cookie.split(";").some((c) => c.trim().startsWith(`${ALIVE}=`));
}

export function clearRememberChoice() {
  try {
    localStorage.removeItem(SESSION_ONLY);
  } catch {
    /* ignore */
  }
}
