"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/departments", label: "Departments" },
  { href: "/admin/teams", label: "Teams" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="mt-5 overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => {
          const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "-mb-px inline-block border-b-2 px-3 py-2.5 text-sm font-medium",
                  active ? "border-brand-500 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-900",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
