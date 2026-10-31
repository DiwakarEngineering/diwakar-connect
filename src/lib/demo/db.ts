"use client";

// DEMO MODE ONLY: a real PostgreSQL (PGlite, WebAssembly) running in this
// browser tab, built from the same migrations as production and persisted in
// IndexedDB. Loaded from /pglite (copied there by `npm run demo`).

export type DemoRow = Record<string, unknown>;

export type DemoTx = {
  query: <R extends DemoRow = DemoRow>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
};

export type DemoDb = DemoTx & {
  transaction: <T>(fn: (tx: DemoTx) => Promise<T>) => Promise<T>;
  listen: (channel: string, cb: (payload: string) => void) => Promise<unknown>;
  close: () => Promise<void>;
};

type PGliteCtor = new (dataDir: string, options?: { parsers?: Record<number, (value: string) => unknown> }) => DemoDb & {
  waitReady: Promise<void>;
};

const DB_PREFIX = "diwakar-connect-demo";
let dbPromise: Promise<DemoDb> | null = null;

/** PostgREST returns ISO-8601 strings; mirror that so app code behaves the same. */
const timestamptz = (v: string) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
const PARSERS: Record<number, (value: string) => unknown> = {
  1184: timestamptz, // timestamptz
  1114: (v) => v.replace(" ", "T"), // timestamp
  1082: (v) => v, // date
  20: (v) => Number(v), // int8
  1700: (v) => Number(v), // numeric
};

async function init(): Promise<DemoDb> {
  const res = await fetch("/api/demo/schema", { cache: "no-store" });
  if (!res.ok) throw new Error("Demo schema unavailable. Start the app with `npm run demo`.");
  const { version, parts } = (await res.json()) as { version: string; parts: string[] };

  // Built at runtime (browser only) so server bundlers don't try to resolve it.
  const moduleUrl = `${window.location.origin}/pglite/index.js`;
  const mod = (await import(/* webpackIgnore: true */ moduleUrl)) as { PGlite: PGliteCtor };
  const db = new mod.PGlite(`idb://${DB_PREFIX}-${version}`, { parsers: PARSERS });
  await db.waitReady;
  await db.exec("set timezone = 'UTC'");

  const { rows } = await db.query<{ ok: boolean }>("select to_regclass('demo.meta') is not null as ok");
  if (!rows[0]?.ok) {
    for (const sql of parts) await db.exec(sql);
  }
  return db;
}

export function getDemoDb(): Promise<DemoDb> {
  dbPromise ??= init().catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Deletes the demo database(s) from this browser and signs out. */
export async function resetDemoData() {
  try {
    const db = dbPromise ? await dbPromise : null;
    await db?.close();
  } catch {
    // ignore
  }
  dbPromise = null;
  try {
    window.localStorage.removeItem("dc-demo-session");
  } catch {
    // storage unavailable
  }
  const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
  await Promise.all(
    dbs
      .map((d) => d.name)
      .filter((name): name is string => !!name && name.includes(DB_PREFIX))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
  );
}
