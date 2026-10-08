// The one JSON object a utility model was asked to answer with, read out of
// what it actually sent: a small model wraps it in code fences or a sentence
// of prose often enough that a bare JSON.parse would lose good answers. Pure,
// so the claims reader, the image rewrite and fact consolidation (and the
// scripts that test them) share it.

// The parsed object, still unvalidated (the caller's zod schema decides what
// it is), or null when the reply holds no parseable object.
export function replyJsonObject(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    // Not JSON: the reply is unusable, which the caller reports.
    return null;
  }
}
