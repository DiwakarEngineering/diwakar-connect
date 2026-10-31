// Shared by scripts/import-employees.mjs (local preview) and
// scripts/supabase-import.mjs (real Supabase project): reads the employee
// export CSV and applies this organization's decisions (roles, passwords,
// department teams).
//
// CSV columns: Employee ID,Name,Email,Phone,Department,Designation,Location,Joining date,Status

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Starting passwords live in .env.local (never committed), not in this file.
function localSetting(key) {
  if (process.env[key]) return process.env[key];
  const file = join(process.cwd(), ".env.local");
  if (!existsSync(file)) return "";
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(file, "utf8"));
  return m?.[1]?.trim() ?? "";
}

// --- Decisions for this organization ----------------------------------------
export const ROLE_BY_EMAIL = {
  "krinic05@gmail.com": "owner", // Krishan Kumar Ranga
  "sbl1744@diwakarsolar.com": "admin", // Sunil Bansal
  "deepanshu@diwakarsolar.com": "admin", // Deepanshu Bansal
  "robin.c.goyal2@gmail.com": "manager", // Robin Goyal
  "lokeshnarain123@gmail.com": "manager", // Lokesh Narain
};
// Rows whose CSV email is blank but whose address is known from elsewhere.
export const EMAIL_FALLBACK = { "DS-1005": "deepanshu@diwakarsolar.com" };
// Shared/test accounts that should not become people.
export const SKIP_IDS = new Set(["DS-1002"]);
export const STAFF_PASSWORD = localSetting("STAFF_PASSWORD");
export const ADMIN_PASSWORD = localSetting("ADMIN_PASSWORD");
export const COMPANY_TEAM = "Diwakar Solar";
// Department heads (by designation) become owners of their department's team.
export const HEAD_PATTERN = /\bhead\b|manager|\bcfo\b|president/i;

const STATUS = { active: "active", invited: "invited", suspended: "suspended", inactive: "deactivated", deactivated: "deactivated" };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((f) => f.trim())) rows.push(row);
  }
  return rows;
}

/** Stable UUID per key, so re-imports keep the same ids. */
export function uuidFor(key) {
  const h = createHash("sha1").update(`diwakar-connect:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function cleanPhone(raw) {
  const v = (raw ?? "").replace(/^'+/, "").trim();
  return /^[0-9+()\- ]{3,30}$/.test(v) ? v : null;
}

/**
 * Reads the CSV and returns { people, skipped, departments, owner, teams }.
 * Each department team: { id, name, ownerIds (heads, or the org owner), memberIds }.
 */
export function loadEmployees(csvPath) {
  if (!STAFF_PASSWORD || !ADMIN_PASSWORD) {
    throw new Error("Set STAFF_PASSWORD and ADMIN_PASSWORD in .env.local (the starting passwords for imported accounts).");
  }
  const [header, ...data] = parseCsv(readFileSync(csvPath, "utf8").replace(/^﻿/, ""));
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const idx = {
    id: col("Employee ID"),
    name: col("Name"),
    email: col("Email"),
    phone: col("Phone"),
    dept: col("Department"),
    title: col("Designation"),
    location: col("Location"),
    joined: col("Joining date"),
    status: col("Status"),
  };
  if (Object.values(idx).some((i) => i < 0)) {
    throw new Error(`CSV is missing expected columns. Found: ${header.join(", ")}`);
  }

  const people = [];
  const skipped = [];
  const seenEmails = new Set();
  for (const r of data) {
    const empId = (r[idx.id] ?? "").trim();
    const name = (r[idx.name] ?? "").trim();
    const email = ((r[idx.email] ?? "").trim() || EMAIL_FALLBACK[empId] || "").toLowerCase();
    if (SKIP_IDS.has(empId)) {
      skipped.push(`${empId} ${name} (shared/test account)`);
      continue;
    }
    if (!email || !name) {
      skipped.push(`${empId} ${name} (no email)`);
      continue;
    }
    if (seenEmails.has(email)) {
      skipped.push(`${empId} ${name} (duplicate email ${email})`);
      continue;
    }
    seenEmails.add(email);
    const joined = (r[idx.joined] ?? "").trim();
    const role = ROLE_BY_EMAIL[email] ?? "employee";
    people.push({
      id: uuidFor(empId || email),
      empId,
      name,
      email,
      phone: cleanPhone(r[idx.phone]),
      dept: (r[idx.dept] ?? "").trim() || null,
      title: (r[idx.title] ?? "").trim() || null,
      location: (r[idx.location] ?? "").trim() || null,
      joined: /^\d{4}-\d{2}-\d{2}$/.test(joined) ? joined : null,
      status: STATUS[(r[idx.status] ?? "").trim().toLowerCase()] ?? "active",
      role,
      password: role === "admin" ? ADMIN_PASSWORD : STAFF_PASSWORD,
    });
  }

  const owner = people.find((p) => p.role === "owner");
  if (!owner) throw new Error("No owner found - set one in ROLE_BY_EMAIL.");
  const departments = [...new Set(people.map((p) => p.dept).filter(Boolean))].sort();

  const teams = departments.map((dept) => {
    const members = people.filter((p) => p.dept === dept && p.status === "active");
    const heads = members.filter((p) => p.title && HEAD_PATTERN.test(p.title));
    const ownerIds = heads.length ? heads.map((p) => p.id) : [owner.id];
    return {
      id: uuidFor(`team:${dept}`),
      name: dept,
      ownerIds,
      memberIds: members.map((p) => p.id).filter((id) => !ownerIds.includes(id)),
    };
  });

  return { people, skipped, departments, owner, teams };
}
