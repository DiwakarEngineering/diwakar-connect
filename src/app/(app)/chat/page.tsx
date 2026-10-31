import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Chat" };

export default function ChatIndexPage() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <EmptyState
        icon={<MessagesSquare className="h-5 w-5" aria-hidden="true" />}
        title="Pick a conversation"
        description="Choose a chat on the left, or start a new one with a colleague or group."
      />
    </div>
  );
}
