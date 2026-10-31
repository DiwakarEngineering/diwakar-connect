"use client";

// DEMO MODE ONLY. Implements the subset of the Supabase JS client used by the
// app on top of the in-browser PGlite database. Every query runs inside a
// transaction as the `authenticated` role with the signed-in user's id as the
// JWT subject, so the real RLS policies, guard triggers and RPCs apply.

import { getDemoDb, type DemoRow, type DemoTx } from "./db";

type Role = "authenticated" | "service_role" | "postgres";
type PgError = { message: string; code?: string; details?: string | null; hint?: string | null };
type Result<T = unknown> = { data: T; error: PgError | null; count: number | null; status: number; statusText: string };

const SESSION_KEY = "dc-demo-session";
type StoredSession = { userId: string; email: string };

function readSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(s: StoredSession | null) {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable
  }
}

function toError(e: unknown): PgError {
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: err?.message ?? String(e), code: err?.code, details: err?.detail ?? null, hint: err?.hint ?? null };
}

/** Runs `fn` in a transaction as the given role and user (RLS applies for authenticated). */
export async function runAs<T>(role: Role, userId: string | null, fn: (tx: DemoTx) => Promise<T>): Promise<T> {
  const db = await getDemoDb();
  return db.transaction(async (tx) => {
    if (role !== "postgres") {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      await tx.exec(`set local role ${role}`);
    }
    return fn(tx);
  });
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

function columnList(cols: string): string {
  const trimmed = cols.trim();
  if (!trimmed || trimmed === "*") return "*";
  return trimmed
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map(ident)
    .join(", ");
}

/** Postgres array literal; PGlite can't serialize arrays of enum/uuid types itself. */
function arrayLiteral(values: readonly unknown[]): string {
  const items = values.map((v) =>
    v === null || v === undefined ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${items.join(",")}}`;
}

class Params {
  values: unknown[] = [];
  add(v: unknown) {
    this.values.push(Array.isArray(v) ? arrayLiteral(v) : v);
    return `$${this.values.length}`;
  }
}

type Filter = (p: Params) => string;

const OPS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };

function parseValue(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

/** Splits on top-level commas, respecting parentheses and double quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** PostgREST logic-tree syntax, e.g. `a.lt."x",and(b.eq."y",c.lt.z)`. */
function parseLogic(expr: string, joiner: "or" | "and"): Filter {
  const parts = splitTop(expr).map((part): Filter => {
    const m = /^(and|or)\((.*)\)$/.exec(part);
    if (m) return parseLogic(m[2]!, m[1] as "and" | "or");
    const [col, op, ...rest] = part.split(".");
    const raw = rest.join(".");
    if (!col || !op) throw new Error(`Unsupported filter: ${part}`);
    if (op === "is") {
      const v = parseValue(raw);
      return () => `${ident(col)} is ${v === null ? "null" : v ? "true" : "false"}`;
    }
    if (op === "in") {
      const list = raw.replace(/^\(|\)$/g, "").split(",").map(parseValue);
      return (p) => `${ident(col)} = any(${p.add(list)})`;
    }
    const sqlOp = OPS[op];
    if (!sqlOp) throw new Error(`Unsupported operator: ${op}`);
    const value = parseValue(raw);
    return (p) => `${ident(col)} ${sqlOp} ${p.add(value)}`;
  });
  return (p) => `(${parts.map((f) => f(p)).join(` ${joiner} `)})`;
}

class DemoQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private columns = "*";
  private countMode: string | undefined;
  private head = false;
  private returning: string | null = null;
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private values: DemoRow | DemoRow[] | null = null;

  constructor(
    private client: DemoSupabaseClient,
    private table: string,
  ) {}

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.columns = columns;
      this.countMode = options?.count;
      this.head = !!options?.head;
    } else {
      this.returning = columns;
    }
    return this;
  }
  insert(values: DemoRow | DemoRow[]) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: DemoRow) {
    this.op = "update";
    this.values = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  private cmp(op: string, col: string, value: unknown) {
    this.filters.push((p) => `${ident(col)} ${op} ${p.add(value)}`);
    return this;
  }
  eq(col: string, v: unknown) {
    return this.cmp("=", col, v);
  }
  neq(col: string, v: unknown) {
    return this.cmp("<>", col, v);
  }
  gt(col: string, v: unknown) {
    return this.cmp(">", col, v);
  }
  gte(col: string, v: unknown) {
    return this.cmp(">=", col, v);
  }
  lt(col: string, v: unknown) {
    return this.cmp("<", col, v);
  }
  lte(col: string, v: unknown) {
    return this.cmp("<=", col, v);
  }
  like(col: string, v: string) {
    return this.cmp("like", col, v);
  }
  ilike(col: string, v: string) {
    return this.cmp("ilike", col, v);
  }
  is(col: string, v: null | boolean) {
    this.filters.push(() => `${ident(col)} is ${v === null ? "null" : v ? "true" : "false"}`);
    return this;
  }
  in(col: string, values: readonly unknown[]) {
    this.filters.push((p) => `${ident(col)} = any(${p.add([...values])})`);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op === "is") this.filters.push(() => `${ident(col)} is not ${v === null ? "null" : v ? "true" : "false"}`);
    else this.filters.push((p) => `not (${ident(col)} ${OPS[op] ?? "="} ${p.add(v)})`);
    return this;
  }
  match(obj: DemoRow) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v);
    return this;
  }
  or(expr: string) {
    this.filters.push(parseLogic(expr, "or"));
    return this;
  }
  textSearch(col: string, query: string, options?: { type?: string; config?: string }) {
    const fn = options?.type === "websearch" ? "websearch_to_tsquery" : options?.type === "phrase" ? "phraseto_tsquery" : "plainto_tsquery";
    this.filters.push((p) => `${ident(col)} @@ ${fn}(${p.add(options?.config ?? "simple")}::regconfig, ${p.add(query)})`);
    return this;
  }
  order(col: string, options?: { ascending?: boolean }) {
    this.orders.push(`${ident(col)} ${options?.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private where(p: Params) {
    return this.filters.length ? ` where ${this.filters.map((f) => f(p)).join(" and ")}` : "";
  }

  private async execute(): Promise<Result> {
    const t = `public.${ident(this.table)}`;
    try {
      const out = await this.client.run(async (tx) => {
        let rows: DemoRow[] = [];
        let count: number | null = null;
        if (this.op === "select") {
          if (this.countMode) {
            const p = new Params();
            const r = await tx.query<{ n: number }>(`select count(*)::int as n from ${t}${this.where(p)}`, p.values);
            count = r.rows[0]?.n ?? 0;
          }
          if (!this.head) {
            const p = new Params();
            let sql = `select ${columnList(this.columns)} from ${t}${this.where(p)}`;
            if (this.orders.length) sql += ` order by ${this.orders.join(", ")}`;
            if (this.limitN !== null) sql += ` limit ${Math.max(0, Math.floor(this.limitN))}`;
            if (this.offsetN !== null) sql += ` offset ${Math.max(0, Math.floor(this.offsetN))}`;
            rows = (await tx.query(sql, p.values)).rows;
          }
        } else if (this.op === "insert") {
          const list = Array.isArray(this.values) ? this.values : [this.values ?? {}];
          const cols = Array.from(new Set(list.flatMap((r) => Object.keys(r))));
          const p = new Params();
          const tuples = list.map((r) => `(${cols.map((c) => (c in r ? p.add(r[c]) : "default")).join(", ")})`);
          const sql =
            cols.length === 0
              ? `insert into ${t} default values`
              : `insert into ${t} (${cols.map(ident).join(", ")}) values ${tuples.join(", ")}`;
          rows = (await tx.query(sql + (this.returning !== null ? ` returning ${columnList(this.returning)}` : ""), p.values)).rows;
        } else if (this.op === "update") {
          const p = new Params();
          const sets = Object.entries(this.values ?? {}).map(([k, v]) => `${ident(k)} = ${p.add(v)}`);
          const sql = `update ${t} set ${sets.join(", ")}${this.where(p)}`;
          rows = (await tx.query(sql + (this.returning !== null ? ` returning ${columnList(this.returning)}` : ""), p.values)).rows;
        } else {
          const p = new Params();
          const sql = `delete from ${t}${this.where(p)}`;
          rows = (await tx.query(sql + (this.returning !== null ? ` returning ${columnList(this.returning)}` : ""), p.values)).rows;
        }
        return { rows, count };
      });

      const wantsRows = this.op === "select" ? !this.head : this.returning !== null;
      let data: unknown = wantsRows ? out.rows : null;
      if (this.singleMode && wantsRows) {
        if (out.rows.length > 1 || (this.singleMode === "single" && out.rows.length === 0)) {
          return {
            data: null,
            error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null },
            count: out.count,
            status: 406,
            statusText: "Not Acceptable",
          };
        }
        data = out.rows[0] ?? null;
      }
      return { data, error: null, count: out.count, status: 200, statusText: "OK" };
    } catch (e) {
      return { data: null, error: toError(e), count: null, status: 400, statusText: "Bad Request" };
    }
  }
}

// ---------------------------------------------------------------------------
// Realtime emulation
// ---------------------------------------------------------------------------
type ChangeListener = {
  table: string;
  event: string;
  filter: { col: string; value: string } | null;
  cb: (payload: { eventType: string; new: DemoRow; old: DemoRow; table: string; schema: string }) => void;
};

const PRIMARY_KEYS: Record<string, string[]> = {
  message_reactions: ["message_id", "user_id", "emoji"],
  conversation_members: ["conversation_id", "user_id"],
};

export class DemoChannel {
  private changeListeners: ChangeListener[] = [];
  private presenceListeners: (() => void)[] = [];
  private presence: Record<string, DemoRow[]> = {};
  private presenceKey: string;

  constructor(
    private client: DemoSupabaseClient,
    readonly topic: string,
    options?: { config?: { presence?: { key?: string } } },
  ) {
    this.presenceKey = options?.config?.presence?.key ?? "";
  }

  on(type: string, filter: { event?: string; table?: string; filter?: string }, cb: (payload: never) => void) {
    if (type === "postgres_changes" && filter.table) {
      const m = filter.filter ? /^(\w+)=eq\.(.+)$/.exec(filter.filter) : null;
      this.changeListeners.push({
        table: filter.table,
        event: filter.event ?? "*",
        filter: m ? { col: m[1]!, value: m[2]! } : null,
        cb: cb as ChangeListener["cb"],
      });
    } else if (type === "presence") {
      this.presenceListeners.push(cb as () => void);
    }
    // Broadcast (typing indicators) has no other participants in a one-browser demo.
    return this;
  }

  subscribe(cb?: (status: string) => void) {
    this.client.addChannel(this);
    void this.client.ready().then(
      () => cb?.("SUBSCRIBED"),
      () => cb?.("CHANNEL_ERROR"),
    );
    return this;
  }

  async send() {
    return "ok";
  }

  async track(payload: DemoRow) {
    if (this.presenceKey) this.presence[this.presenceKey] = [payload];
    this.presenceListeners.forEach((l) => l());
    return "ok";
  }

  presenceState() {
    return this.presence;
  }

  async unsubscribe() {
    this.client.dropChannel(this);
    return "ok";
  }

  /** Called for each database change; re-reads the row as the signed-in user. */
  async dispatch(table: string, type: string, row: DemoRow, fetchRow: () => Promise<DemoRow | null>) {
    const listeners = this.changeListeners.filter((l) => l.table === table && (l.event === "*" || l.event === type));
    if (listeners.length === 0) return;
    const matches = (l: ChangeListener, r: DemoRow) => !l.filter || String(r[l.filter.col]) === l.filter.value;
    if (type === "DELETE") {
      for (const l of listeners) if (matches(l, row)) l.cb({ eventType: type, new: {}, old: row, table, schema: "public" });
      return;
    }
    const full = await fetchRow();
    if (!full) return;
    for (const l of listeners) if (matches(l, full)) l.cb({ eventType: type, new: full, old: {}, table, schema: "public" });
  }
}

// ---------------------------------------------------------------------------
// Auth emulation
// ---------------------------------------------------------------------------
type AuthListener = (event: string, session: unknown) => void;

function authError(message: string) {
  return { name: "AuthApiError", message, status: 400 };
}

function sessionFor(s: StoredSession) {
  return {
    access_token: "demo",
    refresh_token: "demo",
    token_type: "bearer",
    user: { id: s.userId, email: s.email },
  };
}

class DemoAuth {
  private listeners = new Set<AuthListener>();

  private emit(event: string, session: unknown) {
    this.listeners.forEach((l) => l(event, session));
  }

  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const rows = await runAs("postgres", null, (tx) =>
        tx.query<{ id: string; email: string; banned: boolean }>(
          `select u.id, u.email, coalesce(u.banned_until > now(), false) as banned
             from auth.users u join demo.credentials c on c.user_id = u.id
            where lower(u.email) = lower($1)
              and c.password_hash = encode(sha256(convert_to($2, 'UTF8')), 'hex')`,
          [email, password],
        ),
      );
      const user = rows.rows[0];
      if (!user) return { data: { user: null, session: null }, error: authError("Invalid login credentials") };
      if (user.banned) return { data: { user: null, session: null }, error: authError("User is banned") };
      await runAs("postgres", null, (tx) => tx.query("update auth.users set last_sign_in_at = now() where id = $1", [user.id]));
      const stored = { userId: user.id, email: user.email };
      writeSession(stored);
      const session = sessionFor(stored);
      this.emit("SIGNED_IN", session);
      return { data: { user: session.user, session }, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: authError(toError(e).message) };
    }
  }

  async getUser() {
    const s = readSession();
    if (!s) return { data: { user: null }, error: null };
    // The account must still exist in this browser's database.
    const { rows } = await runAs("postgres", null, (tx) => tx.query("select 1 from auth.users where id = $1", [s.userId]));
    if (rows.length === 0) {
      writeSession(null);
      return { data: { user: null }, error: null };
    }
    return { data: { user: sessionFor(s).user }, error: null };
  }

  async getSession() {
    const s = readSession();
    return { data: { session: s ? sessionFor(s) : null }, error: null };
  }

  async signOut(options?: { scope?: string }) {
    if (options?.scope === "others") return { error: null };
    writeSession(null);
    this.emit("SIGNED_OUT", null);
    return { error: null };
  }

  async updateUser(attrs: { password?: string; data?: DemoRow }) {
    const s = readSession();
    if (!s) return { data: { user: null }, error: authError("Not signed in") };
    if (attrs.password) {
      await runAs("postgres", null, (tx) =>
        tx.query(
          `insert into demo.credentials (user_id, password_hash) values ($1, encode(sha256(convert_to($2, 'UTF8')), 'hex'))
           on conflict (user_id) do update set password_hash = excluded.password_hash`,
          [s.userId, attrs.password],
        ),
      );
    }
    return { data: { user: sessionFor(s).user }, error: null };
  }

  async resetPasswordForEmail() {
    // No email in demo mode; behave like Supabase (no account enumeration).
    return { data: {}, error: null };
  }

  async exchangeCodeForSession() {
    return { data: { session: null }, error: authError("Email links aren't available in demo mode.") };
  }
  async setSession() {
    return this.exchangeCodeForSession();
  }
  async verifyOtp() {
    return this.exchangeCodeForSession();
  }

  onAuthStateChange(cb: AuthListener) {
    this.listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } };
  }
}

// ---------------------------------------------------------------------------
// Storage emulation (bytes live in demo.blobs; access goes through RLS on storage.objects)
// ---------------------------------------------------------------------------
class DemoBucket {
  constructor(
    private client: DemoSupabaseClient,
    private bucket: string,
  ) {}

  async upload(path: string, file: Blob, options?: { contentType?: string; upsert?: boolean }) {
    try {
      const contentType = options?.contentType || file.type || "application/octet-stream";
      const { rows } = await runAs("postgres", null, (tx) =>
        tx.query<{ file_size_limit: number | null; allowed_mime_types: string[] | null }>(
          "select file_size_limit, allowed_mime_types from storage.buckets where id = $1",
          [this.bucket],
        ),
      );
      const bucket = rows[0];
      if (!bucket) return { data: null, error: { message: "Bucket not found" } };
      if (bucket.file_size_limit && file.size > bucket.file_size_limit) {
        return { data: null, error: { message: "The object exceeded the maximum allowed size" } };
      }
      if (bucket.allowed_mime_types && !bucket.allowed_mime_types.includes(contentType)) {
        return { data: null, error: { message: `mime type ${contentType} is not supported` } };
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.client.run((tx) =>
        tx.query(
          `insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())${
            options?.upsert ? " on conflict (bucket_id, name) do update set owner = excluded.owner" : ""
          }`,
          [this.bucket, path],
        ),
      );
      await runAs("postgres", null, (tx) =>
        tx.query(
          `insert into demo.blobs (bucket_id, name, content_type, data) values ($1, $2, $3, $4)
           on conflict (bucket_id, name) do update set content_type = excluded.content_type, data = excluded.data`,
          [this.bucket, path, contentType, bytes],
        ),
      );
      return { data: { path, id: path, fullPath: `${this.bucket}/${path}` }, error: null };
    } catch (e) {
      const err = toError(e);
      return { data: null, error: { message: err.code === "23505" ? "The resource already exists" : err.message } };
    }
  }

  async createSignedUrl(path: string) {
    try {
      const visible = await this.client.run((tx) =>
        tx.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [this.bucket, path]),
      );
      if (visible.rows.length === 0) return { data: null, error: { message: "Object not found" } };
      const { rows } = await runAs("postgres", null, (tx) =>
        tx.query<{ data: Uint8Array; content_type: string | null }>(
          "select data, content_type from demo.blobs where bucket_id = $1 and name = $2",
          [this.bucket, path],
        ),
      );
      const blob = rows[0];
      if (!blob) return { data: null, error: { message: "Object not found" } };
      const bytes = new Uint8Array(blob.data);
      const url = URL.createObjectURL(new Blob([bytes], { type: blob.content_type ?? "application/octet-stream" }));
      return { data: { signedUrl: url }, error: null };
    } catch (e) {
      return { data: null, error: { message: toError(e).message } };
    }
  }

  async remove(paths: string[]) {
    try {
      const removed = await this.client.run((tx) =>
        tx.query<{ name: string }>("delete from storage.objects where bucket_id = $1 and name = any($2) returning name", [
          this.bucket,
          arrayLiteral(paths),
        ]),
      );
      const names = removed.rows.map((r) => r.name);
      if (names.length) {
        await runAs("postgres", null, (tx) =>
          tx.query("delete from demo.blobs where bucket_id = $1 and name = any($2)", [this.bucket, arrayLiteral(names)]),
        );
      }
      return { data: names.map((name) => ({ name })), error: null };
    } catch (e) {
      return { data: null, error: { message: toError(e).message } };
    }
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
const functionShapes = new Map<string, "set" | "scalar" | "void">();

export class DemoSupabaseClient {
  readonly auth = new DemoAuth();
  readonly storage = { from: (bucket: string) => new DemoBucket(this, bucket) };
  readonly realtime = { setAuth: () => undefined };
  private channels = new Set<DemoChannel>();
  private listening: Promise<void> | null = null;

  /** Runs as the signed-in user (or anonymously when signed out). */
  run<T>(fn: (tx: DemoTx) => Promise<T>): Promise<T> {
    const s = readSession();
    return runAs("authenticated", s?.userId ?? null, fn);
  }

  ready() {
    this.listening ??= getDemoDb().then((db) =>
      db.listen("dc_changes", (payload) => void this.onChange(payload)).then(() => undefined),
    );
    return this.listening;
  }

  from(table: string) {
    return new DemoQuery(this, table);
  }

  async rpc(fn: string, args: DemoRow = {}) {
    try {
      let shape = functionShapes.get(fn);
      if (!shape) {
        const { rows } = await runAs("postgres", null, (tx) =>
          tx.query<{ proretset: boolean; typname: string }>(
            `select p.proretset, t.typname from pg_proc p
               join pg_type t on t.oid = p.prorettype
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = $1 limit 1`,
            [fn],
          ),
        );
        const meta = rows[0];
        if (!meta) return { data: null, error: { message: `Could not find the function public.${fn}`, code: "PGRST202" } };
        shape = meta.proretset || meta.typname === "record" ? "set" : meta.typname === "void" ? "void" : "scalar";
        functionShapes.set(fn, shape);
      }
      const p = new Params();
      const named = Object.entries(args)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${ident(k)} => ${p.add(v)}`)
        .join(", ");
      const call = `public.${ident(fn)}(${named})`;
      const rows = await this.run((tx) => tx.query(shape === "set" ? `select * from ${call}` : `select ${call} as result`, p.values));
      const data = shape === "set" ? rows.rows : shape === "void" ? null : (rows.rows[0]?.result ?? null);
      return { data, error: null };
    } catch (e) {
      return { data: null, error: toError(e) };
    }
  }

  channel(topic: string, options?: { config?: { presence?: { key?: string } } }) {
    return new DemoChannel(this, topic, options);
  }

  addChannel(ch: DemoChannel) {
    this.channels.add(ch);
    void this.ready();
  }

  dropChannel(ch: DemoChannel) {
    this.channels.delete(ch);
  }

  async removeChannel(ch: DemoChannel) {
    this.channels.delete(ch);
    return "ok";
  }

  private async onChange(raw: string) {
    let parsed: { table: string; type: string; row: DemoRow };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return;
    }
    const { table, type, row } = parsed;
    const keys = PRIMARY_KEYS[table] ?? ["id"];
    let cached: Promise<DemoRow | null> | null = null;
    const fetchRow = () => {
      cached ??= this.run(async (tx) => {
        const p = new Params();
        const where = keys.map((k) => `${ident(k)} = ${p.add(row[k])}`).join(" and ");
        const r = await tx.query(`select * from public.${ident(table)} where ${where}`, p.values);
        return r.rows[0] ?? null;
      }).catch(() => null);
      return cached;
    };
    for (const ch of Array.from(this.channels)) await ch.dispatch(table, type, row, fetchRow);
  }
}

let client: DemoSupabaseClient | null = null;
export function getDemoClient() {
  client ??= new DemoSupabaseClient();
  return client;
}
