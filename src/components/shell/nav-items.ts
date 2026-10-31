import { Bell, Home, MessageSquare, Phone, ShieldCheck, Users, Contact, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "chats" | "channels" | "notifications";
  adminOnly?: boolean;
  mobile?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home, mobile: true },
  { href: "/chat", label: "Chat", icon: MessageSquare, badge: "chats", mobile: true },
  { href: "/teams", label: "Teams", icon: Users, badge: "channels", mobile: true },
  { href: "/calls", label: "Calls", icon: Phone, mobile: true },
  { href: "/people", label: "People", icon: Contact, mobile: true },
  { href: "/notifications", label: "Notifications", icon: Bell, badge: "notifications" },
  { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
];

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
