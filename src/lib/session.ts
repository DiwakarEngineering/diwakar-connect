import type { Enums, Tables } from "@/lib/database.types";

export type SessionInfo = {
  userId: string;
  email: string;
  profile: Tables<"profiles">;
  role: Enums<"app_role">;
  settings: Tables<"organization_settings">;
};

export function isAdminRole(role: Enums<"app_role">) {
  return role === "owner" || role === "admin";
}

export function canCreateTeams(session: SessionInfo) {
  switch (session.settings.team_creation) {
    case "everyone":
      return true;
    case "managers":
      return session.role !== "employee";
    default:
      return isAdminRole(session.role);
  }
}
