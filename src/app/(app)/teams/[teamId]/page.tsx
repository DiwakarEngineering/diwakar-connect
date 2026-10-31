"use client";

import { useParams } from "next/navigation";
import { TeamDetail } from "@/components/teams/team-detail";
import { EmptyState } from "@/components/ui/states";
import { isUuid } from "@/lib/ids";

export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  if (!isUuid(teamId)) return <EmptyState title="Team not found" className="h-full" />;
  return <TeamDetail key={teamId} teamId={teamId} />;
}
