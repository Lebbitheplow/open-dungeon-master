// What a connected agent reads back from a tool. Agent clients cap a tool
// result (Claude Code drops one over roughly 25K tokens), so every result is
// held under MAX_RESULT_CHARS. Cutting the text at the cap used to leave a
// JSON document no agent could parse, and lose whatever came last: in the
// campaign snapshot that was the safety pause, the DM's status and what the
// seat may do. A result is made smaller as JSON instead: lists lose entries,
// long text is clipped, and the result says what was left out and which tool
// reads the rest.

export const MAX_RESULT_CHARS = 60_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type Trimmed = { path: string; shown: number; total: number };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const size = (value: unknown) => JSON.stringify(value).length;

// The largest array that can still lose an entry, and the longest string, in
// one walk. Paths are for the note the agent reads, not for code.
function largest(root: Json, skip: ReadonlySet<string>) {
  let array: { node: Json[]; path: string; size: number } | null = null;
  let text: { holder: JsonObject | Json[]; key: string | number; path: string; length: number } | null = null;
  const walk = (node: Json, path: string) => {
    if (Array.isArray(node)) {
      if (node.length > 1) {
        const bytes = size(node);
        if (!array || bytes > array.size) {
          array = { node, path, size: bytes };
        }
      }
      node.forEach((child, index) => {
        if (typeof child === "string" && (!text || child.length > text.length)) {
          text = { holder: node, key: index, path: `${path}[${index}]`, length: child.length };
        }
        walk(child, `${path}[${index}]`);
      });
    } else if (isObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (!path && skip.has(key)) {
          continue;
        }
        if (typeof child === "string" && (!text || child.length > text.length)) {
          text = { holder: node, key, path: childPath, length: child.length };
        }
        walk(child, childPath);
      }
    }
  };
  walk(root, "");
  return {
    array: array as { node: Json[]; path: string; size: number } | null,
    text: text as { holder: JsonObject | Json[]; key: string | number; path: string; length: number } | null,
  };
}

export function clipText(text: string, keep: number): string {
  return text.length <= keep ? text : `${text.slice(0, keep)}... [${text.length - keep} more characters]`;
}

// Shrinks a parsed result until it serializes under `max`: the biggest list
// keeps its first half, then the longest text is clipped. Top-level keys in
// `protect` are never touched. The note goes in `_truncated` on the result.
export function boundJson(value: Json, max = MAX_RESULT_CHARS, protect: ReadonlySet<string> = new Set()): string {
  const root: JsonObject = isObject(value) ? value : { result: value };
  const trimmed = new Map<string, Trimmed>();
  const note = () =>
    trimmed.size
      ? {
          note: "This result was too long for one reply, so some lists show only their first entries and long text is clipped. Ask for less, or read the part you need with a narrower tool.",
          lists: [...trimmed.values()],
        }
      : { note: "Long text in this result was clipped to fit one reply." };
  for (let round = 0; round < 400; round += 1) {
    const text = JSON.stringify(round ? { ...root, _truncated: note() } : root);
    if (text.length <= max) {
      return text;
    }
    const found = largest(root, protect);
    if (found.array && (!found.text || found.array.size >= found.text.length)) {
      const { node, path } = found.array;
      const total = trimmed.get(path)?.total ?? node.length;
      node.length = Math.ceil(node.length / 2);
      trimmed.set(path, { path, shown: node.length, total });
    } else if (found.text && found.text.length > 200) {
      const { holder, key, length } = found.text;
      const current = (holder as Record<string | number, Json>)[key] as string;
      (holder as Record<string | number, Json>)[key] = clipText(current, Math.max(100, Math.floor(length / 2)));
    } else {
      break;
    }
  }
  return JSON.stringify({
    _truncated: { note: "This result was too large to send. Read a narrower part of it with another tool." },
  });
}

// Every tool result passes through here. Non-JSON text (an error sentence)
// is cut plainly; JSON is shrunk as JSON so it always parses.
export function boundResultText(text: string, max = MAX_RESULT_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    return `${text.slice(0, max)}\n[truncated: ${text.length - max} more characters]`;
  }
  return boundJson(parsed, max);
}

type Message = {
  seq?: number;
  authorType?: string;
  userId?: string | null;
  characterId?: string | null;
  content?: string;
  speaker?: { name?: string } | null;
  createdAt?: string;
};

// One transcript line the way an agent reads it: who said it and what, with
// the browser-only fields (pictures, reroll variants, turn ids) left out.
function agentMessage(message: Message, names: Record<string, string>): JsonObject {
  const from =
    message.authorType === "dm"
      ? (message.speaker?.name ?? "Dungeon Master")
      : message.authorType === "system"
        ? "Table"
        : (message.characterId && names[message.characterId]) || (message.userId && names[message.userId]) || "A player";
  return {
    seq: message.seq ?? 0,
    author: message.authorType ?? "system",
    from,
    ...(message.characterId ? { characterId: message.characterId } : {}),
    ...(message.authorType === "player" && message.userId ? { userId: message.userId } : {}),
    content: message.content ?? "",
    at: message.createdAt ?? "",
  };
}

// Keeps the newest messages that fit `budget` characters, oldest dropped
// first. The newest one is always kept, clipped if it alone is too long.
function newestThatFit(messages: JsonObject[], budget: number): JsonObject[] {
  const kept: JsonObject[] = [];
  let used = 2;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const bytes = size(messages[index]) + 1;
    if (used + bytes > budget) {
      if (!kept.length) {
        const message = messages[index];
        const room = Math.max(200, budget - size({ ...message, content: "" }) - 60);
        kept.unshift({ ...message, content: clipText(String(message.content), room) });
      }
      break;
    }
    used += bytes;
    kept.unshift(messages[index]);
  }
  return kept;
}

function nameMap(members: unknown, sheets: unknown): Record<string, string> {
  const names: Record<string, string> = {};
  for (const member of Array.isArray(members) ? members : []) {
    if (isObject(member) && typeof member.userId === "string" && typeof member.username === "string") {
      names[member.userId] = member.username;
    }
  }
  for (const sheet of Array.isArray(sheets) ? sheets : []) {
    if (isObject(sheet) && typeof sheet.id === "string" && typeof sheet.name === "string") {
      names[sheet.id] = sheet.name;
    }
  }
  return names;
}

const SHEET_SUMMARY = [
  "id", "userId", "name", "race", "class", "subclass", "level", "role",
  "currentHp", "maxHp", "tempHp", "ac", "speed", "conditions", "exhaustion", "deathSaves",
];

function sheetSummary(sheet: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const key of SHEET_SUMMARY) {
    if (sheet[key] !== undefined) {
      out[key] = sheet[key];
    }
  }
  return out;
}

// Lists in the snapshot that run oldest first; the rest run newest first.
// Trimming drops from the oldest end either way.
const OLDEST_FIRST = new Set(["characterEvents", "chapters"]);

function fitExtras(extras: Record<string, Json[]>, budget: number): Trimmed[] {
  const trimmed = new Map<string, Trimmed>();
  while (size(extras) > budget) {
    const [key, list] =
      Object.entries(extras)
        .filter(([, entries]) => entries.length > 0)
        .sort((a, b) => size(b[1]) - size(a[1]))[0] ?? [];
    if (!key || !list) {
      break;
    }
    const keep = Math.floor(list.length / 2);
    extras[key] = OLDEST_FIRST.has(key) ? list.slice(list.length - keep) : list.slice(0, keep);
    trimmed.set(key, { path: key, shown: keep, total: trimmed.get(key)?.total ?? list.length });
  }
  return [...trimmed.values()];
}

// The campaign snapshot (GET /api/campaigns/[id], built for the browser) as
// an agent reads it. The state that decides whether and how to act comes
// first and is never trimmed: the safety pause, the DM's status, this seat's
// caps, the floor, pending rolls, the encounter, open disputes. Then the
// party (this player's own sheets whole, the others summarized), then as many
// of the newest messages as fit, then the smaller lists. Browser-only fields
// (narration audio, background calls, the blocked list, faces, the sheet
// audit) are left out.
export function campaignForAgent(text: string, max = MAX_RESULT_CHARS): string {
  let snapshot: JsonObject;
  try {
    const parsed = JSON.parse(text) as Json;
    if (!isObject(parsed) || !isObject(parsed.campaign)) {
      return boundResultText(text, max);
    }
    snapshot = parsed;
  } catch {
    return boundResultText(text, max);
  }
  const campaign = { ...(snapshot.campaign as JsonObject) };
  const floor = campaign.floor ?? null;
  // The floor is lifted to the top with the rest of the turn state. The
  // story backend's settings are nothing the agent may read or change.
  delete campaign.floor;
  delete campaign.settings;
  const me = isObject(snapshot.me) ? snapshot.me : {};
  const sheets = (Array.isArray(snapshot.sheets) ? snapshot.sheets : []).filter(isObject);
  const names = nameMap(snapshot.members, sheets);
  const core: JsonObject = {
    campaign,
    me,
    activeSheetId: snapshot.activeSheetId ?? "",
    safetyPause: snapshot.safetyPause ?? null,
    dmStatus: snapshot.dmStatus ?? null,
    floor,
    caps: snapshot.caps ?? null,
    pendingRolls: snapshot.pendingRolls ?? [],
    encounter: snapshot.encounter ?? null,
    disputes: snapshot.disputes ?? [],
    itemProposals: snapshot.itemProposals ?? [],
    scene: snapshot.scene ?? null,
    handout: snapshot.handout ?? null,
    titleCard: snapshot.titleCard ?? null,
    latestSeq: snapshot.latestSeq ?? 0,
    members: snapshot.members ?? [],
    sheets: sheets.map((sheet) => (sheet.userId === me.id ? sheet : sheetSummary(sheet))),
  };
  const list = (value: Json | undefined) => (Array.isArray(value) ? value : []);
  const extras: Record<string, Json[]> = {
    rolls: list(snapshot.rolls),
    notes: list(snapshot.notes),
    characterEvents: list(snapshot.characterEvents),
    chapters: list(snapshot.chapters),
    locations: list(snapshot.locations),
    beats: list(snapshot.beats),
  };
  const all = list(snapshot.messages)
    .filter(isObject)
    .map((message) => agentMessage(message as Message, names));
  const history = (shown: JsonObject[]): JsonObject => ({
    shown: shown.length,
    olderBefore: shown.length ? (shown[0].seq as number) : null,
    read: "odm_get_messages pages older messages: pass before = olderBefore.",
  });
  // Room for the history line and a trimming note.
  const room = max - size(core) - 900;
  if (room < 2000) {
    // The table state alone is too big (a huge encounter): bound it as plain
    // JSON, still valid, with the newest message for context.
    return boundJson({ ...core, messages: all.slice(-1), history: history(all.slice(-1)) }, max);
  }
  // The lists give way before the messages do: a player acting now needs the
  // last few passages more than an old roll or the chapter list.
  const trimmed = fitExtras(extras, Math.min(size(extras), Math.floor(room * 0.2)));
  const messages = newestThatFit(all, room - size(extras));
  const view: JsonObject = {
    ...core,
    messages,
    history: history(messages),
    ...extras,
    ...(trimmed.length
      ? { _truncated: { note: "Some lists show only their newest entries to fit one reply.", lists: trimmed } }
      : {}),
  };
  const out = JSON.stringify(view);
  return out.length <= max ? out : boundJson(view, max);
}

// A page of older transcript (GET /api/campaigns/[id]/messages), compacted
// like the snapshot's, and cut from the oldest end when it is still too long
// so `olderBefore` stays the place to continue from.
export function historyForAgent(text: string, max = MAX_RESULT_CHARS): string {
  let page: JsonObject;
  try {
    const parsed = JSON.parse(text) as Json;
    if (!isObject(parsed) || !Array.isArray(parsed.messages)) {
      return boundResultText(text, max);
    }
    page = parsed;
  } catch {
    return boundResultText(text, max);
  }
  const names = isObject(page.names) ? (page.names as Record<string, string>) : {};
  const all = (page.messages as Json[]).filter(isObject).map((message) => agentMessage(message as Message, names));
  const messages = newestThatFit(all, max - 400);
  const cut = messages.length < all.length;
  return JSON.stringify({
    messages,
    olderBefore: messages.length && (cut || page.olderBefore !== null) ? (messages[0].seq as number) : null,
    ...(cut ? { note: `Only the newest ${messages.length} of the ${all.length} messages asked for fit in one reply.` } : {}),
  });
}
