"use client";

import { useParams } from "next/navigation";
import { ConversationView } from "@/components/conversation/conversation-view";
import { EmptyState } from "@/components/ui/states";
import { isUuid } from "@/lib/ids";

/** "Pop out chat": one conversation in its own window, without the app's navigation. */
export default function PopoutChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  if (!isUuid(conversationId)) {
    return <EmptyState title="Conversation not found" description="Check the link and try again." className="h-full" />;
  }
  return <ConversationView conversationId={conversationId} backHref="" />;
}
