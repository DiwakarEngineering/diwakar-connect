"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Lock } from "lucide-react";
import { ConversationView } from "@/components/conversation/conversation-view";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isUuid } from "@/lib/ids";

/** Resolves a channel to its conversation, then renders the shared conversation view. */
export default function ChannelPage() {
  const { teamId, channelId } = useParams<{ teamId: string; channelId: string }>();
  const [conversationId, setConversationId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isUuid(channelId)) {
      setConversationId(null);
      return;
    }
    setConversationId(undefined);
    void getSupabaseBrowserClient()
      .from("conversations")
      .select("id")
      .eq("channel_id", channelId)
      .maybeSingle()
      .then(({ data }) => setConversationId(data?.id ?? null));
  }, [channelId]);

  if (conversationId === undefined) return <LoadingState label="Opening channel" className="h-full" />;
  if (conversationId === null) {
    return (
      <EmptyState
        icon={<Lock className="h-5 w-5" aria-hidden="true" />}
        title="You can't see this channel"
        description="Join the team, or ask a team owner to add you to this private channel."
        action={
          <Link href={`/teams/${teamId}`} className="text-sm font-medium text-brand-700 hover:underline">
            Go to team
          </Link>
        }
        className="h-full"
      />
    );
  }
  return <ConversationView key={conversationId} conversationId={conversationId} backHref={`/teams/${teamId}`} />;
}
