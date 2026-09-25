import { z } from "zod";

// A stored value read back one field at a time: one invalid field (a value
// written by a newer or older build) falls back to its default alone,
// rather than taking every valid field with it. The schema's defaults
// already heal a missing field; this heals an invalid one the same way.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// zod reports every issue in one pass, so one prune is enough. A second
// failure is a member with no default, which pruning cannot heal; the whole
// default is what these reads returned before, and a read that throws would
// take down every page that loads the value.
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
  const healed = schema.safeParse(pruned);
  return healed.success ? healed.data : schema.parse({});
}

// An edit laid over the stored value before it is parsed whole: a member the
// edit leaves out keeps its stored value, at every depth, so an agent that
// sends { variantRules: { ammunition: true } } changes that one rule rather
// than resetting the group's others to their defaults. Arrays are values and
// replace whole; so does anything the stored side holds as a non-object.
export function layOver(stored: unknown, edit: unknown): unknown {
  if (!isRecord(stored) || !isRecord(edit)) {
    return edit;
  }
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(edit)) {
    // JSON.parse makes "__proto__" an own key; assigning it would swap the
    // merged object's prototype and let the body plant inherited members.
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    merged[key] = layOver(stored[key], value);
  }
  return merged;
}
