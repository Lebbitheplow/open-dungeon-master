import { z } from "zod";

// A stored value read back one field at a time: one invalid field (a value
// written by a newer or older build) falls back to its default alone,
// rather than taking every valid field with it. The schema's defaults
// already heal a missing field; this heals an invalid one the same way.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// zod reports every issue in one pass, so one prune is enough; a second
// failure is a schema member with no default, which is a bug and throws.
export function parseKeepingValid<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  if (!isRecord(raw)) {
    return schema.parse({});
  }
  const pruned = structuredClone(raw);
  for (const issue of parsed.error.issues) {
    // The member that holds the bad value: an array item takes its whole
    // array back to the default.
    const firstIndex = issue.path.findIndex((segment) => typeof segment !== "string");
    const path = (firstIndex === -1 ? issue.path : issue.path.slice(0, firstIndex)).map(String);
    let parent: unknown = pruned;
    for (const segment of path.slice(0, -1)) {
      parent = isRecord(parent) ? parent[segment] : undefined;
    }
    if (isRecord(parent) && path.length > 0) {
      delete parent[path[path.length - 1]];
    }
  }
  return schema.parse(pruned);
}
