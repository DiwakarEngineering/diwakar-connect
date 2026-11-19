import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { config } from "./config";

/**
 * Session storage: on phones the refresh token is kept in the OS keychain /
 * keystore (expo-secure-store); the rest of the session (which can exceed
 * SecureStore's size limit) goes to AsyncStorage. On web (preview only) it is
 * localStorage.
 */
const storage =
  Platform.OS === "web"
    ? undefined
    : {
        async getItem(key: string) {
          const raw = await AsyncStorage.getItem(key);
          if (!raw) return null;
          try {
            const session = JSON.parse(raw) as Record<string, unknown>;
            const refresh = await SecureStore.getItemAsync(`${key}.rt`);
            if (refresh) session.refresh_token = refresh;
            return JSON.stringify(session);
          } catch {
            return raw;
          }
        },
        async setItem(key: string, value: string) {
          try {
            const session = JSON.parse(value) as Record<string, unknown>;
            if (typeof session.refresh_token === "string") {
              await SecureStore.setItemAsync(`${key}.rt`, session.refresh_token);
              session.refresh_token = "";
            }
            await AsyncStorage.setItem(key, JSON.stringify(session));
          } catch {
            await AsyncStorage.setItem(key, value);
          }
        },
        async removeItem(key: string) {
          await AsyncStorage.removeItem(key);
          await SecureStore.deleteItemAsync(`${key}.rt`);
        },
      };

export const supabase = createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh the session only while the app is in the foreground (Supabase's recommendation for React Native).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}

export function friendlyError(error: { message?: string } | null | undefined, fallback = "Something went wrong. Please try again."): string {
  const message = error?.message?.trim();
  if (!message) return fallback;
  if (/Invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/network|fetch/i.test(message)) return "Can't reach the server. Check your connection and try again.";
  if (/JWT|session/i.test(message)) return "Your session has expired. Please sign in again.";
  return message;
}

/** Calls a Diwakar Connect website API as the signed-in user (used for calls). */
export async function siteApi<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  let res: Response;
  try {
    res = await fetch(`${config.siteUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok || !json) {
    const err = new Error(json?.error?.message ?? `Request failed (${res.status}).`) as Error & { code?: string };
    err.code = json?.error?.code;
    throw err;
  }
  return json;
}
