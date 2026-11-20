import { router } from "expo-router";
import type { RpcRow, Tables } from "@/lib/database.types";
import { config } from "@/lib/config";
import { friendlyError, supabase } from "@/lib/supabase";

export type MeetingRow = RpcRow<"list_my_meetings">;
export type Meeting = Tables<"meetings">;

/** Same labels as the website. */
export const RESPONSE_LABEL = { pending: "Not answered", accepted: "Accepted", tentative: "Tentative", declined: "Declined" } as const;

/** "Join" is offered from 15 minutes before the start until the end, or while a call is live. */
export function joinable(m: { starts_at: string; ends_at: string; live?: boolean; cancelled_at: string | null }, now = Date.now()) {
  if (m.cancelled_at) return false;
  return !!m.live || (now >= new Date(m.starts_at).getTime() - 15 * 60_000 && now <= new Date(m.ends_at).getTime());
}

/** "1234567890" -> "123 456 7890" */
export const formatCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3, 6)} ${code.slice(6)}`;

export const timeText = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function whenText(m: { starts_at: string; ends_at: string }) {
  const s = new Date(m.starts_at);
  return `${s.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${timeText(m.starts_at)} – ${timeText(m.ends_at)}`;
}

export const meetingLink = (code: string) => `${config.siteUrl}/meet/${code}`;

/** Same invitation text as the website's "Copy invitation". */
export function invitationText(m: Pick<Meeting, "title" | "starts_at" | "ends_at" | "code" | "passcode" | "allow_guests">) {
  return [
    m.title,
    whenText(m),
    "",
    `Join: ${meetingLink(m.code)}`,
    `Meeting ID: ${formatCode(m.code)}`,
    `Passcode: ${m.passcode}`,
    m.allow_guests ? "Guests without a Diwakar account can join with the ID and passcode; the organizer admits them." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function joinMeetingCall(conversationId: string, title?: string) {
  router.push({ pathname: "/call/[conversationId]", params: { conversationId, media: "video", ...(title ? { title } : {}) } });
}

/** Meet now: a one-hour meeting starting immediately, then straight into its call. */
export async function meetNow(firstName: string): Promise<string | null> {
  const start = new Date();
  const { data, error } = await supabase.rpc("create_meeting", {
    p_title: `Meeting with ${firstName}`,
    p_starts_at: start.toISOString(),
    p_ends_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
    p_invitee_ids: [],
  });
  if (error || !data) return friendlyError(error, "Couldn't start a meeting.");
  const { data: m } = await supabase.from("meetings").select("conversation_id, title").eq("id", data).single();
  if (m) joinMeetingCall(m.conversation_id, m.title);
  return null;
}
