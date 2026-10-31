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
