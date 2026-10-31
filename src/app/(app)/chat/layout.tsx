"use client";

import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ConversationList } from "@/components/chat/conversation-list";

/** List + conversation split view; one pane at a time on mobile. */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inConversation = pathname !== "/chat";
  return (
    <div className="flex h-full min-h-0">
      <div
        className={clsx(
          "h-full w-full shrink-0 border-r border-line md:block md:w-[320px] lg:w-[360px]",
          inConversation && "hidden",
        )}
      >
        <ConversationList />
      </div>
      <div className={clsx("h-full min-w-0 flex-1", !inConversation && "hidden md:block")}>{children}</div>
    </div>
  );
}
