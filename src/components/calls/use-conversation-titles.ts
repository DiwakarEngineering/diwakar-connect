"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type ConversationLabel = { title: string; href: string; kind: "direct" | "group" | "channel" };

/** Titles and links for every conversation the user can see (chats and channels). */
export function useConversationTitles(enabled = true) {
  const [labels, setLabels] = useState<Map<string, ConversationLabel>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    const supabase = getSupabaseBrowserClient();
    void Promise.all([supabase.rpc("list_my_conversations", { p_limit: 200 }), supabase.rpc("list_my_channels")]).then(
      ([chats, channels]) => {
        const map = new Map<string, ConversationLabel>();
        for (const c of chats.data ?? []) map.set(c.conversation_id, { title: c.title, href: `/chat/${c.conversation_id}`, kind: c.kind });
        for (const c of channels.data ?? []) {
          map.set(c.conversation_id, {
            title: `#${c.channel_name} · ${c.team_name}`,
            href: `/teams/${c.team_id}/${c.channel_id}`,
            kind: "channel",
          });
        }
        setLabels(map);
      },
    );
  }, [enabled]);
  return labels;
}
