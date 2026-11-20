// Types for the public schema, in the format produced by `supabase gen types`.
// Regenerate after changing migrations:  npm run db:types
// (Hand-maintained to match supabase/migrations until a project is linked.)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string; updated_at: string };

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      organization_settings: {
        Row: {
          id: boolean;
          organization_name: string;
          allowed_email_domains: string[];
          team_creation: Database["public"]["Enums"]["team_creation_policy"];
          directory_show_email: boolean;
          directory_show_phone: boolean;
          directory_show_work_location: boolean;
          message_edit_window_minutes: number | null;
          allow_message_delete: boolean;
          max_attachment_mb: number;
          calls_enabled: boolean;
          meeting_creation: Database["public"]["Enums"]["team_creation_policy"];
          allow_guest_meetings: boolean;
          recording_policy: "off" | "organizers" | "admins";
          updated_by: string | null;
        } & Timestamps;
        Insert: never;
        Update: {
          organization_name?: string;
          allowed_email_domains?: string[];
          team_creation?: Database["public"]["Enums"]["team_creation_policy"];
          directory_show_email?: boolean;
          directory_show_phone?: boolean;
          directory_show_work_location?: boolean;
          message_edit_window_minutes?: number | null;
          allow_message_delete?: boolean;
          max_attachment_mb?: number;
          calls_enabled?: boolean;
          meeting_creation?: Database["public"]["Enums"]["team_creation_policy"];
          allow_guest_meetings?: boolean;
          recording_policy?: "off" | "organizers" | "admins";
          updated_by?: string | null;
        };
        Relationships: [];
      };
      departments: {
        Row: { id: string; name: string; description: string | null } & Timestamps;
        Insert: { id?: string; name: string; description?: string | null };
        Update: { name?: string; description?: string | null };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_path: string | null;
          title: string | null;
          department_id: string | null;
          availability: Database["public"]["Enums"]["availability"];
          status_message: string | null;
          employment_status: Database["public"]["Enums"]["employment_status"];
          last_seen_at: string | null;
        } & Timestamps;
        Insert: never;
        Update: {
          display_name?: string;
          avatar_path?: string | null;
          title?: string | null;
          department_id?: string | null;
          availability?: Database["public"]["Enums"]["availability"];
          status_message?: string | null;
          employment_status?: Database["public"]["Enums"]["employment_status"];
        };
        Relationships: [];
      };
      profile_details: {
        Row: {
          user_id: string;
          email: string;
          phone: string | null;
          work_location: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: { phone?: string | null; work_location?: string | null };
        Relationships: [];
      };
      user_roles: {
        Row: {
          user_id: string;
          role: Database["public"]["Enums"]["app_role"];
          assigned_by: string | null;
          updated_at: string;
        };
        Insert: { user_id: string; role?: Database["public"]["Enums"]["app_role"]; assigned_by?: string | null };
        Update: { role?: Database["public"]["Enums"]["app_role"]; assigned_by?: string | null };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          user_id: string;
          mentions: boolean;
          replies: boolean;
          team_invites: boolean;
          calls: boolean;
          updated_at: string;
        };
        Insert: never;
        Update: { mentions?: boolean; replies?: boolean; team_invites?: boolean; calls?: boolean };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          visibility: Database["public"]["Enums"]["team_visibility"];
          created_by: string | null;
          archived_at: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          visibility?: Database["public"]["Enums"]["team_visibility"];
          created_by: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          visibility?: Database["public"]["Enums"]["team_visibility"];
          archived_at?: string | null;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          team_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["team_member_role"];
          added_by: string | null;
          created_at: string;
        };
        Insert: { team_id: string; user_id: string; role?: Database["public"]["Enums"]["team_member_role"] };
        Update: { role?: Database["public"]["Enums"]["team_member_role"] };
        Relationships: [];
      };
      channels: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          description: string | null;
          visibility: Database["public"]["Enums"]["channel_visibility"];
          is_general: boolean;
          created_by: string | null;
          archived_at: string | null;
        } & Timestamps;
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          description?: string | null;
          visibility?: Database["public"]["Enums"]["channel_visibility"];
        };
        Update: {
          name?: string;
          description?: string | null;
          visibility?: Database["public"]["Enums"]["channel_visibility"];
          archived_at?: string | null;
        };
        Relationships: [];
      };
      channel_members: {
        Row: { channel_id: string; user_id: string; added_by: string | null; created_at: string };
        Insert: { channel_id: string; user_id: string };
        Update: never;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          kind: Database["public"]["Enums"]["conversation_kind"];
          title: string | null;
          channel_id: string | null;
          direct_key: string | null;
          created_by: string | null;
          last_message_at: string | null;
        } & Timestamps;
        Insert: never;
        Update: { title?: string | null };
        Relationships: [];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["conversation_member_role"];
          added_by: string | null;
          joined_at: string;
          left_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      conversation_user_state: {
        Row: {
          conversation_id: string;
          user_id: string;
          last_read_at: string | null;
          is_pinned: boolean;
          is_muted: boolean;
          is_favorite: boolean;
          last_delivered_at: string | null;
          cleared_at: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string | null;
          kind: Database["public"]["Enums"]["message_kind"];
          body: string;
          reply_to_id: string | null;
          mentions: string[];
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          pinned_at: string | null;
          pinned_by: string | null;
          forwarded_from_id: string | null;
          sticker: string | null;
          search: unknown;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          reply_to_id?: string | null;
          mentions?: string[];
          forwarded_from_id?: string | null;
          sticker?: string | null;
        };
        Update: { body?: string; mentions?: string[]; deleted_at?: string | null };
        Relationships: [];
      };
      message_reactions: {
        Row: { message_id: string; user_id: string; emoji: string; created_at: string };
        Insert: { message_id: string; user_id: string; emoji: string };
        Update: never;
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          message_id: string;
          conversation_id: string;
          uploader_id: string | null;
          object_path: string;
          file_name: string;
          mime_type: string;
          size_bytes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          conversation_id: string;
          uploader_id: string;
          object_path: string;
          file_name: string;
          mime_type: string;
          size_bytes: number;
        };
        Update: never;
        Relationships: [];
      };
      calls: {
        Row: {
          id: string;
          conversation_id: string;
          started_by: string | null;
          media: Database["public"]["Enums"]["call_media"];
          status: Database["public"]["Enums"]["call_status"];
          room_name: string;
          started_at: string;
          ended_at: string | null;
          ended_by: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          started_by: string;
          media?: Database["public"]["Enums"]["call_media"];
          room_name: string;
        };
        Update: {
          status?: Database["public"]["Enums"]["call_status"];
          ended_at?: string | null;
          ended_by?: string | null;
        };
        Relationships: [];
      };
      call_participants: {
        Row: { id: string; call_id: string; user_id: string; joined_at: string; left_at: string | null };
        Insert: { id?: string; call_id: string; user_id: string };
        Update: { left_at?: string | null };
        Relationships: [];
      };
      call_invites: {
        Row: {
          call_id: string;
          user_id: string;
          status: Database["public"]["Enums"]["call_invite_status"];
          created_at: string;
          responded_at: string | null;
        };
        // Written only by the server (service role) and database functions; RLS blocks clients.
        Insert: {
          call_id: string;
          user_id: string;
          status?: Database["public"]["Enums"]["call_invite_status"];
          responded_at?: string | null;
        };
        Update: { status?: Database["public"]["Enums"]["call_invite_status"]; responded_at?: string | null };
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          conversation_id: string;
          channel_id: string | null;
          title: string;
          description: string | null;
          starts_at: string;
          ends_at: string;
          organizer_id: string | null;
          code: string;
          passcode: string;
          allow_guests: boolean;
          reminder_sent_at: string | null;
          cancelled_at: string | null;
        } & Timestamps;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      meeting_invitees: {
        Row: {
          meeting_id: string;
          user_id: string;
          response: Database["public"]["Enums"]["meeting_response"];
          responded_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      meeting_lobby: {
        Row: {
          id: string;
          meeting_id: string;
          user_id: string | null;
          guest_name: string | null;
          secret_hash: string | null;
          status: Database["public"]["Enums"]["lobby_status"];
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
        };
        // Guests are added by the server (service role) only.
        Insert: { meeting_id: string; guest_name: string; secret_hash: string; status?: Database["public"]["Enums"]["lobby_status"] };
        Update: { status?: Database["public"]["Enums"]["lobby_status"] };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          kind: Database["public"]["Enums"]["notification_kind"];
          actor_id: string | null;
          conversation_id: string | null;
          message_id: string | null;
          team_id: string | null;
          call_id: string | null;
          meeting_id: string | null;
          title: string;
          body: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          kind: Database["public"]["Enums"]["notification_kind"];
          actor_id?: string | null;
          conversation_id?: string | null;
          call_id?: string | null;
          title: string;
          body?: string | null;
        };
        Update: { read_at?: string | null };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: number;
          actor_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          actor_id?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Json;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: { Args: never; Returns: boolean };
      is_owner: { Args: never; Returns: boolean };
      can_create_teams: { Args: never; Returns: boolean };
      can_manage_team: { Args: { p_team: string }; Returns: boolean };
      can_access_conversation: { Args: { p_conversation: string }; Returns: boolean };
      can_post_to_conversation: { Args: { p_conversation: string }; Returns: boolean };
      // Service role only (execute is revoked from API roles).
      user_can_access_conversation: { Args: { p_conversation: string; p_user: string }; Returns: boolean };
      activate_my_account: { Args: never; Returns: Database["public"]["Enums"]["employment_status"] };
      touch_last_seen: { Args: never; Returns: undefined };
      get_or_create_direct_conversation: { Args: { p_other_user: string }; Returns: string };
      create_group_conversation: { Args: { p_member_ids: string[]; p_title?: string | null }; Returns: string };
      add_conversation_members: { Args: { p_conversation_id: string; p_member_ids: string[] }; Returns: number };
      remove_conversation_member: { Args: { p_conversation_id: string; p_user_id: string }; Returns: undefined };
      mark_conversation_read: { Args: { p_conversation_id: string }; Returns: undefined };
      set_conversation_preferences: {
        Args: {
          p_conversation_id: string;
          p_is_pinned?: boolean | null;
          p_is_muted?: boolean | null;
          p_is_favorite?: boolean | null;
        };
        Returns: undefined;
      };
      clear_conversation_history: { Args: { p_conversation_id: string }; Returns: string };
      mark_all_notifications_read: { Args: never; Returns: number };
      create_meeting: {
        Args: {
          p_title: string;
          p_starts_at: string;
          p_ends_at: string;
          p_invitee_ids?: string[];
          p_description?: string | null;
          p_channel_id?: string | null;
          p_allow_guests?: boolean;
        };
        Returns: string;
      };
      update_meeting: {
        Args: {
          p_meeting_id: string;
          p_title: string;
          p_starts_at: string;
          p_ends_at: string;
          p_description?: string | null;
          p_allow_guests?: boolean;
          p_add_invitee_ids?: string[];
        };
        Returns: undefined;
      };
      cancel_meeting: { Args: { p_meeting_id: string }; Returns: undefined };
      respond_to_meeting: { Args: { p_meeting_id: string; p_response: "accepted" | "tentative" | "declined" }; Returns: undefined };
      can_schedule_meetings: { Args: never; Returns: boolean };
      can_manage_meeting: { Args: { p_meeting: string }; Returns: boolean };
      list_my_meetings: {
        Args: { p_from: string; p_to: string };
        Returns: {
          meeting_id: string;
          conversation_id: string;
          channel_id: string | null;
          title: string;
          description: string | null;
          starts_at: string;
          ends_at: string;
          organizer_id: string | null;
          code: string;
          allow_guests: boolean;
          cancelled_at: string | null;
          my_response: Database["public"]["Enums"]["meeting_response"] | null;
          invitee_count: number;
          live: boolean;
        }[];
      };
      meeting_by_code: {
        Args: { p_code: string };
        Returns: {
          meeting_id: string;
          title: string;
          starts_at: string;
          ends_at: string;
          organizer_id: string | null;
          conversation_id: string | null;
          is_member: boolean;
          cancelled: boolean;
        }[];
      };
      request_meeting_access: { Args: { p_code: string; p_passcode: string }; Returns: string | null };
      decide_lobby: { Args: { p_lobby_id: string; p_admit: boolean }; Returns: Database["public"]["Enums"]["lobby_status"] };
      meeting_attendance: {
        Args: { p_meeting_id: string };
        Returns: { user_id: string | null; guest_name: string | null; first_joined: string | null; last_left: string | null; minutes: number | null }[];
      };
      respond_to_call: {
        Args: { p_call_id: string; p_response: "declined" | "missed" };
        Returns: Database["public"]["Enums"]["call_invite_status"] | null;
      };
      pin_message: { Args: { p_message_id: string; p_pinned: boolean }; Returns: undefined };
      mark_conversations_delivered: { Args: never; Returns: undefined };
      find_group_conversation: { Args: { p_member_ids: string[] }; Returns: string | null };
      get_message_receipts: {
        Args: { p_conversation_id: string };
        Returns: { user_id: string; last_read_at: string | null; last_delivered_at: string | null }[];
      };
      get_read_receipts: {
        Args: { p_conversation_id: string };
        Returns: { user_id: string; last_read_at: string }[];
      };
      list_my_conversations: {
        Args: { p_unread_only?: boolean; p_search?: string | null; p_limit?: number };
        Returns: {
          conversation_id: string;
          kind: Database["public"]["Enums"]["conversation_kind"];
          title: string;
          other_user_id: string | null;
          member_count: number;
          last_message_at: string;
          last_message_preview: string | null;
          last_message_kind: Database["public"]["Enums"]["message_kind"] | null;
          last_sender_id: string | null;
          unread_count: number;
          is_pinned: boolean;
          is_muted: boolean;
          is_favorite: boolean;
          team_id: string | null;
          team_name: string | null;
          channel_id: string | null;
        }[];
      };
      list_teams: {
        Args: never;
        Returns: {
          team_id: string;
          name: string;
          description: string | null;
          visibility: Database["public"]["Enums"]["team_visibility"];
          archived_at: string | null;
          member_count: number;
          is_member: boolean;
          my_role: Database["public"]["Enums"]["team_member_role"] | null;
          can_manage: boolean;
          created_at: string;
        }[];
      };
      list_my_channels: {
        Args: never;
        Returns: {
          team_id: string;
          team_name: string;
          team_archived: boolean;
          channel_id: string;
          channel_name: string;
          channel_description: string | null;
          channel_visibility: Database["public"]["Enums"]["channel_visibility"];
          is_general: boolean;
          channel_archived: boolean;
          conversation_id: string;
          last_message_at: string | null;
          unread_count: number;
        }[];
      };
      search_directory: {
        Args: { p_query?: string | null; p_department_id?: string | null; p_limit?: number; p_offset?: number };
        Returns: {
          id: string;
          display_name: string;
          avatar_path: string | null;
          title: string | null;
          department_id: string | null;
          department_name: string | null;
          availability: Database["public"]["Enums"]["availability"];
          status_message: string | null;
          employment_status: Database["public"]["Enums"]["employment_status"];
          role: Database["public"]["Enums"]["app_role"] | null;
          email: string | null;
          phone: string | null;
          work_location: string | null;
          last_seen_at: string | null;
          total_count: number;
        }[];
      };
      admin_list_users: {
        Args: {
          p_query?: string | null;
          p_status?: Database["public"]["Enums"]["employment_status"] | null;
          p_role?: Database["public"]["Enums"]["app_role"] | null;
          p_department_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          id: string;
          display_name: string;
          avatar_path: string | null;
          title: string | null;
          department_id: string | null;
          department_name: string | null;
          employment_status: Database["public"]["Enums"]["employment_status"];
          role: Database["public"]["Enums"]["app_role"] | null;
          email: string | null;
          last_seen_at: string | null;
          last_sign_in_at: string | null;
          created_at: string;
          total_count: number;
        }[];
      };
      admin_usage_summary: {
        Args: never;
        Returns: {
          total_users: number;
          active_users: number;
          invited_users: number;
          suspended_users: number;
          deactivated_users: number;
          teams: number;
          channels: number;
          messages_7d: number;
          active_senders_7d: number;
          calls_7d: number;
          call_minutes_7d: number;
        }[];
      };
    };
    Enums: {
      app_role: "owner" | "admin" | "manager" | "employee";
      employment_status: "invited" | "active" | "suspended" | "deactivated";
      availability: "available" | "busy" | "do_not_disturb" | "away" | "offline";
      conversation_kind: "direct" | "group" | "channel";
      team_visibility: "public" | "private";
      channel_visibility: "standard" | "private";
      team_member_role: "owner" | "member";
      conversation_member_role: "owner" | "member";
      notification_kind: "mention" | "reply" | "team_invite" | "call" | "system";
      call_status: "active" | "ended";
      call_media: "audio" | "video";
      call_invite_status: "ringing" | "accepted" | "declined" | "missed";
      meeting_response: "pending" | "accepted" | "tentative" | "declined";
      lobby_status: "waiting" | "admitted" | "rejected" | "left";
      team_creation_policy: "admins" | "managers" | "everyone";
      message_kind: "user" | "system";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
export type RpcReturn<T extends keyof PublicSchema["Functions"]> = PublicSchema["Functions"][T]["Returns"];
export type RpcRow<T extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][T]["Returns"] extends (infer R)[] ? R : never;
