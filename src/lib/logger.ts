import "server-only";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Keys that must never reach logs, even if a caller passes them by mistake.
const REDACTED_KEYS = /pass(word)?|token|secret|key|authorization|cookie|body|content|message_text/i;

type Fields = Record<string, string | number | boolean | null | undefined>;

function threshold(): number {
  const level = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return ORDER[level] ?? ORDER.info;
}

function sanitize(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = REDACTED_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}

/**
 * Structured JSON logs (one line per event). Log identifiers and outcomes,
 * never message content, emails in bulk, or credentials.
 */
function log(level: Level, event: string, fields: Fields = {}) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Fields) => log("debug", event, fields),
  info: (event: string, fields?: Fields) => log("info", event, fields),
  warn: (event: string, fields?: Fields) => log("warn", event, fields),
  error: (event: string, fields?: Fields) => log("error", event, fields),
};
