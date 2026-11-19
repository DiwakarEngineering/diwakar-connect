import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Tables } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export type Person = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "avatar_path" | "title" | "availability" | "status_message" | "employment_status" | "department_id" | "last_seen_at"
>;

const COLUMNS = "id, display_name, avatar_path, title, availability, status_message, employment_status, department_id, last_seen_at";

type Ctx = { people: Map<string, Person>; ensure: (ids: (string | null | undefined)[]) => void };
const PeopleContext = createContext<Ctx | null>(null);

/** Cache of colleagues' public profiles, kept fresh by Realtime (availability and status changes). */
export function PeopleProvider({ children }: { children: ReactNode }) {
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const requested = useRef(new Set<string>());
  const queue = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    timer.current = null;
    const ids = Array.from(queue.current);
    queue.current.clear();
    if (ids.length === 0) return;
    const { data } = await supabase.from("profiles").select(COLUMNS).in("id", ids);
    if (!data?.length) return;
    setPeople((m) => {
      const next = new Map(m);
      for (const p of data) next.set(p.id, p);
      return next;
    });
  }, []);

  const ensure = useCallback(
    (ids: (string | null | undefined)[]) => {
      let added = false;
      for (const id of ids) {
        if (id && !requested.current.has(id)) {
          requested.current.add(id);
          queue.current.add(id);
          added = true;
        }
      }
      if (added && !timer.current) timer.current = setTimeout(() => void flush(), 30);
    },
    [flush],
  );

  useEffect(() => {
    const channel = supabase
      .channel("people-cache")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const p = payload.new as Person;
        setPeople((m) => (m.has(p.id) ? new Map(m).set(p.id, { ...m.get(p.id)!, ...p }) : m));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const value = useMemo(() => ({ people, ensure }), [people, ensure]);
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}

export function usePeopleById(ids: (string | null | undefined)[]) {
  const ctx = useContext(PeopleContext);
  if (!ctx) throw new Error("usePeopleById must be used inside PeopleProvider");
  const key = ids.filter(Boolean).join(",");
  const { ensure, people } = ctx;
  useEffect(() => {
    ensure(key ? key.split(",") : []);
  }, [ensure, key]);
  return people;
}
