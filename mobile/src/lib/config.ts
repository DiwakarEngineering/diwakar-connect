import Constants from "expo-constants";

type Extra = { supabaseUrl?: string; supabaseAnonKey?: string; siteUrl?: string };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Public settings (the same values the website sends to every browser). Set in app.json → expo.extra. */
export const config = {
  supabaseUrl: extra.supabaseUrl ?? "",
  supabaseAnonKey: extra.supabaseAnonKey ?? "",
  /** The Diwakar Connect website: call tokens and password resets go through it. */
  siteUrl: (extra.siteUrl ?? "").replace(/\/+$/, ""),
};
