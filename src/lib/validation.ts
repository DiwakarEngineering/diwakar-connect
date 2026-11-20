import { z } from "zod";

export const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

// Supabase enforces its own minimum too; this keeps the UX consistent.
export const newPassword = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(72, "Use at most 72 characters")
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number");

export const displayName = z.string().trim().min(1, "Name is required").max(80, "Keep it under 80 characters");

export const appRole = z.enum(["owner", "admin", "manager", "employee"]);
export const employmentStatus = z.enum(["active", "suspended", "deactivated"]);

export const inviteSchema = z.object({
  email,
  displayName,
  role: appRole.default("employee"),
  title: z.string().trim().max(100).optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const updateUserSchema = z
  .object({
    status: employmentStatus.optional(),
    role: appRole.optional(),
    displayName: displayName.optional(),
    title: z.string().trim().max(100).nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const callTokenSchema = z.object({
  conversationId: z.string().uuid(),
  media: z.enum(["audio", "video"]).default("video"),
});

export const callIdSchema = z.object({ callId: z.string().uuid() });

export const callInviteSchema = z.object({
  callId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1).max(20),
});

/** A call participant: an employee id, or a meeting guest ("guest:<lobby id>"). */
const PARTICIPANT_ID = /^(guest:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const callModerateSchema = z.discriminatedUnion("action", [
  z.object({ callId: z.string().uuid(), action: z.literal("mute"), userId: z.string().regex(PARTICIPANT_ID) }),
  z.object({ callId: z.string().uuid(), action: z.literal("remove"), userId: z.string().regex(PARTICIPANT_ID) }),
  z.object({ callId: z.string().uuid(), action: z.literal("mute_all") }),
  z.object({ callId: z.string().uuid(), action: z.literal("stop_share"), userId: z.string().regex(PARTICIPANT_ID) }),
]);

export const convertSchema = z.object({ attachmentId: z.string().uuid() });

export const guestJoinSchema = z.object({
  code: z.string().transform((v) => v.replace(/\D/g, "")).pipe(z.string().length(10)),
  passcode: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z0-9]{6}$/, "Passcode is 6 letters or numbers")),
  name: z.string().trim().min(1, "Enter your name").max(60),
});

export const guestRequestSchema = z.object({ requestId: z.string().uuid(), secret: z.string().min(20).max(100) });

export const teamSchema = z.object({
  name: z.string().trim().min(1, "Team name is required").max(80),
  description: z.string().trim().max(500).optional(),
  visibility: z.enum(["public", "private"]),
});

export const channelSchema = z.object({
  name: z.string().trim().min(1, "Channel name is required").max(50),
  description: z.string().trim().max(300).optional(),
  visibility: z.enum(["standard", "private"]),
});

export const domainList = z
  .string()
  .transform((v) =>
    v
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter domains like diwakarsolar.com")).max(20));

/** Only allow same-site relative redirects after sign-in. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
