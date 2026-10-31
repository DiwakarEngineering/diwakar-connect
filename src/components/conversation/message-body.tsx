import { Fragment, useMemo } from "react";
import clsx from "clsx";

const URL_PATTERN = "https?:\\/\\/[^\\s<>\"']+[^\\s<>\"'.,;:!?)\\]]";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Renders message text as plain React text nodes (never as HTML), turning
 * http(s) URLs into links and highlighting @mentions of known people.
 */
export function MessageBody({ body, mentionNames, isOwn }: { body: string; mentionNames: string[]; isOwn?: boolean }) {
  const parts = useMemo(() => {
    const names = mentionNames.filter(Boolean).sort((a, b) => b.length - a.length).map((n) => "@" + escapeRegExp(n));
    const pattern = new RegExp(`(${[URL_PATTERN, ...names].join("|")})`, "g");
    const out: { type: "text" | "url" | "mention"; value: string }[] = [];
    let last = 0;
    for (const match of body.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > last) out.push({ type: "text", value: body.slice(last, index) });
      const value = match[0];
      out.push({ type: value.startsWith("@") ? "mention" : "url", value });
      last = index + value.length;
    }
    if (last < body.length) out.push({ type: "text", value: body.slice(last) });
    return out;
  }, [body, mentionNames]);

  return (
    <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-900">
      {parts.map((part, i) => {
        if (part.type === "url") {
          return (
            <a
              key={i}
              href={part.value}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-600"
            >
              {part.value}
            </a>
          );
        }
        if (part.type === "mention") {
          return (
            <span key={i} className={clsx("rounded px-0.5 font-semibold", isOwn ? "text-brand-800" : "bg-brand-50 text-brand-700")}>
              {part.value}
            </span>
          );
        }
        return <Fragment key={i}>{part.value}</Fragment>;
      })}
    </p>
  );
}
