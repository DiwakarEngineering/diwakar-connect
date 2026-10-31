"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useSession } from "@/components/providers/session-provider";
import { usePeopleById } from "@/components/providers/people-provider";
import type { ConversationMeta } from "./types";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; meta: ConversationMeta };

/** Loads everything the conversation header, composer and member list need. */
export function useConversationMeta(conversationId: string) {
  const { session } = useSession();
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) return setState({ status: "error", message: friendlyError(error) });
    if (!conversation) return setState({ status: "not-found" });

    const [{ data: canPost }, { data: userState }] = await Promise.all([
      supabase.rpc("can_post_to_conversation", { p_conversation: conversationId }),
      supabase
        .from("conversation_user_state")
        .select("is_pinned, is_muted, cleared_at")
        .eq("conversation_id", conversationId)
        .eq("user_id", session.userId)
        .maybeSingle(),
    ]);

    let memberIds: string[] = [];
    let canManage = false;
    let channel: ConversationMeta["channel"] = null;
    let team: ConversationMeta["team"] = null;

    if (conversation.kind === "channel" && conversation.channel_id) {
      const { data: ch } = await supabase.from("channels").select("*").eq("id", conversation.channel_id).maybeSingle();
      if (!ch) return setState({ status: "not-found" });
      channel = ch;
      const [{ data: t }, { data: manage }, members] = await Promise.all([
        supabase.from("teams").select("id, name, archived_at").eq("id", ch.team_id).maybeSingle(),
        supabase.rpc("can_manage_team", { p_team: ch.team_id }),
        ch.visibility === "private"
          ? supabase.from("channel_members").select("user_id").eq("channel_id", ch.id)
          : supabase.from("team_members").select("user_id").eq("team_id", ch.team_id),
      ]);
      team = t ?? null;
      canManage = !!manage;
      memberIds = (members.data ?? []).map((m) => m.user_id);
    } else {
      const { data: members } = await supabase
        .from("conversation_members")
        .select("user_id, role, left_at")
        .eq("conversation_id", conversationId);
      const current = (members ?? []).filter((m) => !m.left_at);
      memberIds = current.map((m) => m.user_id);
      canManage = current.some((m) => m.user_id === session.userId && m.role === "owner");
    }

    const otherUserId =
      conversation.kind === "direct" ? (memberIds.find((id) => id !== session.userId) ?? session.userId) : null;

    setState({
      status: "ready",
      meta: {
        id: conversation.id,
        kind: conversation.kind,
        title: "",
        otherUserId,
        memberIds,
        canPost: !!canPost,
        canManage,
        isPinned: userState?.is_pinned ?? false,
        isMuted: userState?.is_muted ?? false,
        clearedAt: userState?.cleared_at ?? null,
        channel,
        team,
        groupTitle: conversation.title,
      },
    });
  }, [conversationId, session.userId]);

  useEffect(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  const memberIds = state.status === "ready" ? state.meta.memberIds : [];
  const people = usePeopleById(memberIds);

  // Titles depend on cached names, so compute them here rather than in load().
  const resolved = useMemo<State>(() => {
    if (state.status !== "ready") return state;
    const m = state.meta;
    let title = m.groupTitle ?? "";
    if (m.kind === "channel") title = m.channel?.name ?? "Channel";
    else if (m.kind === "direct") {
      const other = m.otherUserId ? people.get(m.otherUserId) : undefined;
      title = other ? (m.otherUserId === session.userId ? `${other.display_name} (you)` : other.display_name) : "Chat";
    } else if (!title) {
      const names = m.memberIds
        .filter((id) => id !== session.userId)
        .map((id) => people.get(id)?.display_name)
        .filter(Boolean)
        .slice(0, 3);
      title = names.length ? names.join(", ") : "Group chat";
    }
    return { status: "ready", meta: { ...m, title } };
  }, [people, session.userId, state]);

  const patch = useCallback((update: Partial<ConversationMeta>) => {
    setState((s) => (s.status === "ready" ? { status: "ready", meta: { ...s.meta, ...update } } : s));
  }, []);

  return { state: resolved, reload: load, patch };
}
