"use client";

import { useEffect, useState } from "react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/env";

export type CallConfig =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; providerConfigured: boolean; enabledByOrganization: boolean };

let cached: Promise<CallConfig> | null = null;

function fetchConfig(): Promise<CallConfig> {
  // Demo mode has no call server: say so instead of pretending.
  if (isDemoMode()) return Promise.resolve({ status: "ready", providerConfigured: false, enabledByOrganization: true });
  cached ??= fetch("/api/calls/config", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return { status: "error" } as const;
      const body = (await res.json()) as { providerConfigured: boolean; enabledByOrganization: boolean };
      return { status: "ready", ...body } as const;
    })
    .catch(() => {
      cached = null;
      return { status: "error" } as const;
    });
  return cached;
}

/** Whether the call provider is configured on the server and calls are enabled. */
export function useCallConfig(): CallConfig {
  const [config, setConfig] = useState<CallConfig>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    void fetchConfig().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

export function callsAvailable(config: CallConfig) {
  return config.status === "ready" && config.providerConfigured && config.enabledByOrganization;
}

/** The ongoing call in a conversation, kept live via Realtime. */
export function useActiveCall(conversationId: string) {
  const [call, setCall] = useState<Tables<"calls"> | null>(null);
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let alive = true;
    void supabase
      .from("calls")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("status", "active")
      .maybeSingle()
      .then(({ data }) => alive && setCall(data));
    const channel = supabase
      .channel(`calls:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as Tables<"calls">;
          if (!row?.id) return;
          setCall(row.status === "active" ? row : null);
        },
      )
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);
  return call;
}
