import type { Metadata } from "next";
import { NewConversation } from "@/components/chat/new-conversation";

export const metadata: Metadata = { title: "New chat" };

export default function NewChatPage() {
  return <NewConversation />;
}
