import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { CallView } from "@/calls/call-view";

export default function CallScreen() {
  const { conversationId, media } = useLocalSearchParams<{ conversationId: string; media?: string }>();
  const [title, setTitle] = useState("Call");
  useEffect(() => {
    void supabase.rpc("list_my_conversations", { p_limit: 300 }).then(({ data }) => {
      const row = (data ?? []).find((c) => c.conversation_id === conversationId);
      if (row) setTitle(row.title);
    });
  }, [conversationId]);
  return <CallView conversationId={conversationId} media={media === "audio" ? "audio" : "video"} title={title} />;
}
