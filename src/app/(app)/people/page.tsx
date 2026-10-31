"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Building2, ChevronLeft, ChevronRight, Contact, Mail, MapPin, MessageSquare, Phone, Search, Video, X } from "lucide-react";
import type { RpcRow, Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/constants";
import { Avatar, usePresenceState } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/providers/session-provider";

type Person = RpcRow<"search_directory">;
const PAGE_SIZE = 24;

function PresenceLine({ person }: { person: Person }) {
  const presence = usePresenceState(person.id, person.availability);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
      <span className={clsx("h-2 w-2 rounded-full", presence.dotClass)} aria-hidden="true" />
      {presence.online ? presence.label : `Offline${person.last_seen_at ? ` · seen ${relativeTime(person.last_seen_at)}` : ""}`}
    </span>
  );
}

function ProfilePanel({ person, onClose }: { person: Person; onClose: () => void }) {
  const router = useRouter();
  const { session } = useSession();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const isMe = person.id === session.userId;

  async function open(target: "chat" | "audio" | "video") {
    setBusy(target);
    const { data, error } = await getSupabaseBrowserClient().rpc("get_or_create_direct_conversation", { p_other_user: person.id });
    setBusy(null);
    if (error || !data) {
      push({ tone: "error", title: "Couldn't open a chat", description: friendlyError(error) });
      return;
    }
    router.push(target === "chat" ? `/chat/${data}` : `/call/${data}?media=${target}`);
  }

  return (
    <aside
      aria-label={`${person.display_name} profile`}
      className="fixed inset-0 z-40 overflow-y-auto bg-white lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:border-l lg:border-line"
    >
      <div className="flex justify-end p-2">
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
          aria-label="Close profile"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="px-6 pb-8 text-center">
        <Avatar name={person.display_name} path={person.avatar_path} userId={person.id} availability={person.availability} showPresence size="xl" className="mx-auto" />
        <h2 className="mt-3 text-lg font-semibold text-ink-900">{person.display_name}</h2>
        {person.title ? <p className="text-sm text-ink-600">{person.title}</p> : null}
        <div className="mt-2 flex justify-center">
          <PresenceLine person={person} />
        </div>
        {person.status_message ? <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-sm italic text-ink-700">&ldquo;{person.status_message}&rdquo;</p> : null}
        {person.employment_status !== "active" ? (
          <Badge tone="warning" className="mt-2">
            {STATUS_LABEL[person.employment_status]}
          </Badge>
        ) : null}
        {!isMe && person.employment_status === "active" ? (
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" size="sm" loading={busy === "chat"} onClick={() => void open("chat")}>
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Chat
            </Button>
            <Button size="sm" loading={busy === "audio"} onClick={() => void open("audio")} aria-label={`Audio call ${person.display_name}`}>
              <Phone className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="sm" loading={busy === "video"} onClick={() => void open("video")} aria-label={`Video call ${person.display_name}`}>
              <Video className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
      <dl className="space-y-4 border-t border-line px-6 py-5 text-sm">
        <div className="flex gap-3">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
          <div>
            <dt className="text-xs text-ink-500">Department</dt>
            <dd className="text-ink-900">{person.department_name ?? "Not set"}</dd>
          </div>
        </div>
        {person.email ? (
          <div className="flex gap-3">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs text-ink-500">Email</dt>
              <dd className="truncate">
                <a href={`mailto:${person.email}`} className="text-brand-700 hover:underline">
                  {person.email}
                </a>
              </dd>
            </div>
          </div>
        ) : null}
        {person.phone ? (
          <div className="flex gap-3">
            <Phone className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <div>
              <dt className="text-xs text-ink-500">Phone</dt>
              <dd>
                <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} className="text-brand-700 hover:underline">
                  {person.phone}
                </a>
              </dd>
            </div>
          </div>
        ) : null}
        {person.work_location ? (
          <div className="flex gap-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <div>
              <dt className="text-xs text-ink-500">Work location</dt>
              <dd className="text-ink-900">{person.work_location}</dd>
            </div>
          </div>
        ) : null}
        {person.role && person.role !== "employee" ? (
          <div className="flex gap-3">
            <Contact className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            <div>
              <dt className="text-xs text-ink-500">Role</dt>
              <dd className="text-ink-900">{ROLE_LABEL[person.role]}</dd>
            </div>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}

export default function PeoplePage() {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Person[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Tables<"departments">[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    void supabase
      .from("departments")
      .select("*")
      .order("name")
      .then(({ data }) => setDepartments(data ?? []));
  }, [supabase]);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc("search_directory", {
      p_query: query.trim() || null,
      p_department_id: department || null,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (loadError) {
      setError(friendlyError(loadError, "Couldn't load the directory."));
      return;
    }
    setError(null);
    setRows(data ?? []);
    setTotal(Number(data?.[0]?.total_count ?? 0));
  }, [department, page, query, supabase]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [load, query]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
          <h1 className="hidden text-xl font-semibold text-ink-900 md:block">People</h1>
          <p className="text-sm text-ink-500">Find colleagues across sites and departments.</p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search name, title, department or email"
                aria-label="Search the directory"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm"
              />
            </div>
            <Select
              aria-label="Filter by department"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setPage(0);
              }}
              className="sm:w-60"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
            {error ? (
              <ErrorState message={error} onRetry={() => void load()} />
            ) : rows === null ? (
              <SkeletonRows rows={8} />
            ) : rows.length === 0 ? (
              <EmptyState icon={<Contact className="h-5 w-5" aria-hidden="true" />} title="No one matches" description="Try a different name or department." />
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(p)}
                      aria-pressed={selected?.id === p.id}
                      className={clsx("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas", selected?.id === p.id && "bg-brand-50")}
                    >
                      <Avatar name={p.display_name} path={p.avatar_path} userId={p.id} availability={p.availability} showPresence size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-900">{p.display_name}</span>
                        <span className="block truncate text-xs text-ink-500">
                          {[p.title, p.department_name].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <PresenceLine person={p} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {total > PAGE_SIZE ? (
            <nav aria-label="Directory pages" className="mt-4 flex items-center justify-between text-sm text-ink-600">
              <span>
                {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
              </span>
              <span className="flex gap-2">
                <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </nav>
          ) : null}
        </div>
      </div>
      {selected ? <ProfilePanel person={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
