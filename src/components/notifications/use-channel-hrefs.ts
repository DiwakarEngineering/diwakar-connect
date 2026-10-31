"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** conversation_id -> /teams/<team>/<channel> for channel conversations the user can see. */
export function useChannelHrefs() {
  const [hrefs, setHrefs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void getSupabaseBrowserClient()
      .rpc("list_my_channels")
      .then(({ data }) => {
        setHrefs(new Map((data ?? []).map((c) => [c.conversation_id, `/teams/${c.team_id}/${c.channel_id}`])));
      });
  }, []);
  return hrefs;
}
