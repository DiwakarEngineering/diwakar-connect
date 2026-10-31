import type { Enums } from "@/lib/database.types";

export const APP_NAME = "Diwakar Connect";
export const COMPANY_NAME = "Diwakar Solar";

export const AVAILABILITY: Record<Enums<"availability">, { label: string; dot: string; description: string }> = {
  available: { label: "Available", dot: "bg-success-600", description: "Ready to chat" },
  busy: { label: "Busy", dot: "bg-danger-600", description: "Focused, reply later" },
  do_not_disturb: { label: "Do not disturb", dot: "bg-danger-700", description: "Only urgent matters" },
  away: { label: "Away", dot: "bg-warning-600", description: "Stepped away" },
  offline: { label: "Appear offline", dot: "bg-ink-300", description: "Hidden from presence" },
};

export const ROLE_LABEL: Record<Enums<"app_role">, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

export const STATUS_LABEL: Record<Enums<"employment_status">, string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

/** Mirrors the bucket allow-list in supabase/migrations/*_storage_realtime.sql. */
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
export const MESSAGE_PAGE_SIZE = 40;
export const MAX_MESSAGE_LENGTH = 8000;

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "👀"] as const;
