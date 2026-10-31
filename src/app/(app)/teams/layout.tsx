"use client";

import { usePathname } from "next/navigation";
import clsx from "clsx";
import { TeamsSidebar } from "@/components/teams/teams-sidebar";

export default function TeamsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // On mobile the sidebar *is* the index; deeper pages replace it.
  const atIndex = pathname === "/teams";
  return (
    <div className="flex h-full min-h-0">
      <div className="hidden h-full w-[300px] shrink-0 border-r border-line md:block lg:w-[320px]">
        <TeamsSidebar />
      </div>
      <div className={clsx("h-full min-w-0 flex-1 overflow-y-auto", atIndex && "bg-canvas")}>{children}</div>
    </div>
  );
}
