"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CallRoom } from "@/components/calls/call-room";
import { LoadingState } from "@/components/ui/states";
import { isUuid } from "@/lib/ids";

function CallPageInner() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const params = useSearchParams();
  const media = params.get("media") === "audio" ? "audio" : "video";
  if (!isUuid(conversationId)) {
    return <p className="p-8 text-center text-sm text-ink-300">This call link is invalid.</p>;
  }
  return <CallRoom key={conversationId} conversationId={conversationId} initialMedia={media} />;
}

export default function CallPage() {
  return (
    <Suspense fallback={<LoadingState label="Preparing call" className="min-h-dvh text-ink-300" />}>
      <CallPageInner />
    </Suspense>
  );
}
