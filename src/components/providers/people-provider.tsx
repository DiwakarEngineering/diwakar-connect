"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Tables } from "@/lib/database.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type Person = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "avatar_path" | "title" | "availability" | "status_message" | "employment_status" | "department_id" | "last_seen_at"
>;

const PERSON_COLUMNS =
  "id, display_name, avatar_path, title, availability, status_message, employment_status, department_id, last_seen_at";

type PeopleContextValue = {
  people: Map<string, Person>;
  ensure: (ids: (string | null | undefined)[]) => void;
  upsert: (person: Person) => void;
};

const PeopleContext = createContext<PeopleContextValue | null>(null);

/**
 * Shared cache of profile summaries (names, avatars, availability) so message
 * lists and member lists don't refetch the same people. Kept fresh via Realtime.
 */
export function PeopleProvider({ children, seed }: { children: ReactNode; seed: Person }) {
  const supabase = getSupabaseBrowserClient();
  const [people, setPeople] = useState<Map<string, Person>>(() => new Map([[seed.id, seed]]));
  const pending = useRef(new Set<string>());
  const requested = useRef(new Set<string>([seed.id]));
  const timer = useRef<number | null>(null);

  const flush = useCallback(async () => {
    timer.current = null;
    const ids = Array.from(pending.current);
    pending.current.clear();
    if (ids.length === 0) return;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data, error } = await supabase.from("profiles").select(PERSON_COLUMNS).in("id", chunk);
      if (error) {
        // Allow another attempt later.
        for (const id of chunk) requested.current.delete(id);
        continue;
      }
      setPeople((prev) => {
        const next = new Map(prev);
        for (const p of data ?? []) next.set(p.id, p);
        return next;
      });
    }
  }, [supabase]);

  const ensure = useCallback(
    (ids: (string | null | undefined)[]) => {
      let added = false;
      for (const id of ids) {
        if (!id || requested.current.has(id)) continue;
        requested.current.add(id);
        pending.current.add(id);
        added = true;
      }
      if (added && timer.current === null) timer.current = window.setTimeout(() => void flush(), 20);
    },
    [flush],
  );

  const upsert = useCallback((person: Person) => {
    requested.current.add(person.id);
    setPeople((prev) => new Map(prev).set(person.id, person));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("people-updates")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const p = payload.new as Tables<"profiles">;
        setPeople((prev) => {
          if (!prev.has(p.id)) return prev;
          const next = new Map(prev);
          next.set(p.id, {
            id: p.id,
            display_name: p.display_name,
            avatar_path: p.avatar_path,
            title: p.title,
            availability: p.availability,
            status_message: p.status_message,
            employment_status: p.employment_status,
            department_id: p.department_id,
            last_seen_at: p.last_seen_at,
          });
          return next;
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  const value = useMemo(() => ({ people, ensure, upsert }), [people, ensure, upsert]);
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeople() {
  const ctx = useContext(PeopleContext);
  if (!ctx) throw new Error("usePeople must be used inside PeopleProvider");
  return ctx;
}

/** Returns cached people for the ids, fetching any that are missing. */
export function usePeopleById(ids: (string | null | undefined)[]) {
  const { people, ensure } = usePeople();
  const key = ids.filter(Boolean).join(",");
  useEffect(() => {
    if (key) ensure(key.split(","));
  }, [ensure, key]);
  return people;
}

export function usePerson(id: string | null | undefined): Person | undefined {
  const people = usePeopleById([id]);
  return id ? people.get(id) : undefined;
}
