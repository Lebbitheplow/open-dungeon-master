import { z } from "zod";
import { d20Expression, type Advantage } from "@/lib/dice";
import { exhaustionRollState, mergeAdvantage, rollDerivation } from "@/lib/dm/condition-logic";
import { normalizeAbility, normalizeAdvantage, normalizeRollKind } from "@/lib/dm/arg-coerce";
import { DM_TOOL_NAME_PATTERN, toolTextRegex, xmlToolCallRegex } from "@/lib/dm/tool-text";
import { computeSheetDerived, findSkill, SRD_SKILLS } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { StreamedToolCall } from "@/lib/model-client";

export const rollArgsSchema = z.object({
  characterId: z.string().optional(),
  kind: z.preprocess(
    normalizeRollKind,
    z.enum([
      "skill_check",
      "saving_throw",
      "ability_check",
      "attack",
      "damage",
      "initiative",
      "custom",
    ]),
  ),
  skill: z.string().optional(),
  ability: z.preprocess(
    normalizeAbility,
    z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  ),
  dc: z.coerce.number().int().min(1).max(40).optional(),
  expression: z.string().max(60).optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
  // kind=damage only: the enemy this damage strikes; the server applies the
  // rolled total to that enemy the moment the dice resolve.
  targetEnemyId: z.string().optional(),
  // kind=damage only: damage type, so resistances and immunities apply.
  damageType: z.string().optional(),
  reason: z.string().optional(),
});

export type RollArgs = z.infer<typeof rollArgsSchema>;

export type ParsedToolCall = {
  id?: string;
  name: string;
  rawArguments: string;
};

export function extractToolCalls(toolCalls: unknown): ParsedToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  const parsed: ParsedToolCall[] = [];
  for (const call of toolCalls) {
    const raw = call as StreamedToolCall & { function?: { name?: unknown; arguments?: unknown } };
    const name = typeof raw?.function?.name === "string" ? raw.function.name : "";
    if (!name) {
      continue;
    }
    const args =
      typeof raw.function?.arguments === "string"
        ? raw.function.arguments
        : JSON.stringify(raw.function?.arguments ?? {});
    parsed.push({ id: typeof raw.id === "string" ? raw.id : undefined, name, rawArguments: args });
  }
  return parsed;
}

// Parses "key=value key2=value with spaces" bodies from leaked textual tool
// calls. Values run until the next "key=" boundary; bare ints and booleans
// are coerced so the results satisfy the tools' JSON schemas.
function parseKeyValueArgs(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const boundaries = [...body.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g)];
  for (let index = 0; index < boundaries.length; index += 1) {
    const match = boundaries[index];
    const start = match.index! + match[0].length;
    const end = index + 1 < boundaries.length ? boundaries[index + 1].index! : body.length;
    const key = match[1];
    let value = body.slice(start, end).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (/^-?\d+$/.test(value)) {
      args[key] = Number(value);
    } else if (value === "true" || value === "false") {
      args[key] = value === "true";
    } else {
      args[key] = value;
    }
  }
  return args;
}

const KNOWN_TOOL_NAMES = new Set(DM_TOOL_NAME_PATTERN.split("|"));

// Coerce a leaked parameter value the way the tools' JSON schemas expect:
// bare ints and booleans, JSON for array/object payloads, else the string.
function coerceLeakValue(raw: string): unknown {
  const value = raw.trim();
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

// qwen3.6's chat template instructs the model to emit tool calls in an XML
// dialect: <tool_call><function=name><parameter=key>value</parameter>...
// </function></tool_call>. llama-server normally extracts these into
// structured tool_calls, but its parser intermittently misses and the raw
// XML lands in message content. Since this is the model's DOCUMENTED
// format, parse it deterministically here: matched blocks become synthetic
// calls, all tags are stripped from the narration, and unknown tool names
// are stripped but never dispatched. A JSON body inside <tool_call>
// ({"name":...,"arguments":{...}}, the older Qwen dialect) is also accepted.
export function salvageXmlToolCalls(text: string): {
  text: string;
  calls: ParsedToolCall[];
} {
  if (!text || !/<\/?(?:tool_call|function[=>]|parameter=)/i.test(text)) {
    return { text, calls: [] };
  }
  const calls: ParsedToolCall[] = [];

  const addCall = (name: string, args: Record<string, unknown>) => {
    if (!KNOWN_TOOL_NAMES.has(name)) {
      return;
    }
    calls.push({
      id: `xml-salvaged-${calls.length}`,
      name,
      rawArguments: JSON.stringify(args),
    });
  };

  const parseFunctionBlocks = (block: string) => {
    const functionRe = /<function=([^>\s]+)>([\s\S]*?)(?:<\/function>|$)/gi;
    let fn: RegExpExecArray | null;
    while ((fn = functionRe.exec(block))) {
      const args: Record<string, unknown> = {};
      const paramRe = /<parameter=([^>\s]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/gi;
      let param: RegExpExecArray | null;
      while ((param = paramRe.exec(fn[2]))) {
        args[param[1]] = coerceLeakValue(param[2]);
      }
      addCall(fn[1], args);
    }
  };

  const blockRe = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi;
  let block: RegExpExecArray | null;
  let sawWrappedFunction = false;
  while ((block = blockRe.exec(text))) {
    const body = block[1];
    if (body.includes("<function=")) {
      sawWrappedFunction = true;
      parseFunctionBlocks(body);
      continue;
    }
    // JSON dialect: {"name": "...", "arguments": {...}}.
    const jsonStart = body.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(body.slice(jsonStart).trim()) as {
          name?: unknown;
          arguments?: unknown;
        };
        if (typeof parsed.name === "string") {
          addCall(
            parsed.name,
            parsed.arguments && typeof parsed.arguments === "object"
              ? (parsed.arguments as Record<string, unknown>)
              : {},
          );
        }
      } catch {
        // Malformed JSON body: strip it below, dispatch nothing.
      }
    }
  }
  // Bare <function=...> blocks outside any <tool_call> wrapper.
  if (!sawWrappedFunction && !text.includes("<tool_call")) {
    parseFunctionBlocks(text);
  }

  const cleaned = text
    .replace(xmlToolCallRegex(), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: cleaned, calls };
}

// Some models emit tool calls as literal narration text instead of
// structured tool_calls, e.g. "[request_roll characterId=... kind=custom
// expression=1d20+3 reason=...]". Salvage them: strip the bracket text from
// the narration and return synthetic calls that run through the normal tool
// pipeline, so dice actually roll instead of raw brackets reaching players.
export function salvageTextualToolCalls(text: string): {
  text: string;
  calls: ParsedToolCall[];
} {
  if (!text) {
    return { text, calls: [] };
  }
  const calls: ParsedToolCall[] = [];
  const cleaned = text
    .replace(toolTextRegex(), (_match, name: string, body: string) => {
      const args = parseKeyValueArgs(body);
      if (Object.keys(args).length) {
        calls.push({
          id: `salvaged-${calls.length}`,
          name,
          rawArguments: JSON.stringify(args),
        });
      }
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text: cleaned, calls };
}

const ABILITY_WORDS: Record<string, "str" | "dex" | "con" | "int" | "wis" | "cha"> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

// Longest names first so "Sleight of Hand" wins over any shorter overlap.
const SKILLS_BY_LENGTH = [...SRD_SKILLS].sort((a, b) => b.name.length - a.name.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sentences like "**Avery, make an Intelligence (Investigation) check,
// DC 15.**" are the model asking for dice in prose instead of calling
// request_roll (a residual qwen failure the bracket salvage cannot catch:
// there is no bracket to find). Convert each such sentence into a synthetic
// request_roll call and strip the meta-text; the roll card carries the ask.
export function salvageProseRollAsks(
  text: string,
  sheets: CharacterSheet[],
): { text: string; calls: ParsedToolCall[] } {
  if (!text || !sheets.length) {
    return { text, calls: [] };
  }
  const calls: ParsedToolCall[] = [];
  const removals: Array<[number, number]> = [];
  const sentenceRe = /[^.!?\n]+[.!?]*/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceRe.exec(text))) {
    const sentence = match[0];
    if (!/\b(make|makes|roll|rolls|attempt|give me|I need|let'?s see|needs? to)\b/i.test(sentence)) {
      continue;
    }
    const isSave = /\bsaving throws?\b|\bsaves?\b/i.test(sentence);
    const isInitiative = /\binitiative\b/i.test(sentence);
    const hasCheck = /\bchecks?\b/i.test(sentence);
    if (!isSave && !isInitiative && !hasCheck) {
      continue;
    }

    // Targets: named party members; "everyone"-style asks hit the whole
    // party; otherwise the solo character. Ambiguous multiplayer asks with
    // no resolvable name are left alone rather than guessed.
    const named = sheets.filter((sheet) =>
      new RegExp(`\\b${escapeRegExp(sheet.name)}\\b`, "i").test(sentence),
    );
    const wholeParty = /\b(everyone|everybody|all of you|each of you|the (?:whole )?party|both of you)\b/i.test(
      sentence,
    );
    const targets = named.length
      ? named
      : wholeParty
        ? sheets
        : sheets.length === 1
          ? sheets
          : [];
    if (!targets.length) {
      continue;
    }

    const dcMatch = /\bDC\s*:?\s*(\d{1,2})\b/i.exec(sentence);
    const abilityMatch =
      /\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/i.exec(sentence);
    const ability = abilityMatch ? ABILITY_WORDS[abilityMatch[1].toLowerCase()] : undefined;
    const skill = SKILLS_BY_LENGTH.find((entry) =>
      new RegExp(`\\b${escapeRegExp(entry.name)}\\b`, "i").test(sentence),
    );

    let base: Record<string, unknown> | null = null;
    if (isInitiative) {
      base = { kind: "initiative" };
    } else if (isSave && ability) {
      base = { kind: "saving_throw", ability };
    } else if (skill) {
      base = { kind: "skill_check", skill: skill.id };
    } else if (ability && hasCheck) {
      base = { kind: "ability_check", ability };
    }
    if (!base) {
      continue;
    }
    if (dcMatch && base.kind !== "initiative") {
      base.dc = Number(dcMatch[1]);
    }
    for (const target of targets) {
      calls.push({
        id: `prose-roll-${calls.length}`,
        name: "request_roll",
        rawArguments: JSON.stringify({ ...base, characterId: target.id }),
      });
    }

    // Swallow trailing bold markers so no orphan ** litters the narration
    // (leading ones sit inside the sentence match already).
    let end = match.index + sentence.length;
    if (text.slice(end, end + 2) === "**") {
      end += 2;
    }
    removals.push([match.index, end]);
  }
  if (!calls.length) {
    return { text, calls: [] };
  }
  let cleaned = "";
  let cursor = 0;
  for (const [start, end] of removals) {
    cleaned += text.slice(cursor, start);
    cursor = end;
  }
  cleaned += text.slice(cursor);
  return {
    text: cleaned
      .replace(/(^|\s)\*\*(\s|$)/g, "$1$2")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    calls,
  };
}

// Resolve a request_roll call into a canonical expression using the sheet as
// the only source of modifiers. Conditions on the sheet auto-derive
// advantage/disadvantage (poisoned checks, restrained DEX saves) and can
// auto-fail outright (paralyzed STR/DEX saves); the model's situational
// advantage claim merges in as one more source.
export function resolveRollExpression(
  args: RollArgs,
  sheet: CharacterSheet | null,
):
  | { expression: string; detail: string; conditionNotes?: string[] }
  | { autoFail: true; detail: string; notes: string[] }
  | { error: string } {
  const derivationKind =
    args.kind === "skill_check" ||
    args.kind === "ability_check" ||
    args.kind === "saving_throw" ||
    args.kind === "initiative"
      ? args.kind
      : null;
  const derivation =
    sheet && derivationKind
      ? rollDerivation(sheet.conditions, derivationKind, args.ability)
      : { advantage: "none" as const, autoFail: false, notes: [] };
  if (derivation.autoFail) {
    return { autoFail: true, detail: args.ability ?? "", notes: derivation.notes };
  }
  const exhaustion =
    sheet && derivationKind
      ? exhaustionRollState(sheet.exhaustion ?? 0, derivationKind)
      : { advantage: "none" as const, note: null };
  const advantage: Advantage = mergeAdvantage([
    args.advantage ?? "none",
    derivation.advantage,
    exhaustion.advantage,
  ]);
  const allNotes = [...derivation.notes, ...(exhaustion.note ? [exhaustion.note] : [])];
  const conditionNotes = allNotes.length ? allNotes : undefined;

  if (args.kind === "skill_check") {
    if (!sheet) {
      return { error: "skill_check needs a valid characterId from GAME STATE." };
    }
    // Models often send display names ("Sleight of Hand"); normalize to ids.
    const normalizedSkill = (args.skill ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const skill = normalizedSkill ? findSkill(normalizedSkill) : null;
    if (!skill) {
      return { error: `Unknown skill "${args.skill ?? ""}". Use a 5e skill id like "stealth".` };
    }
    const derived = computeSheetDerived(sheet);
    return {
      expression: d20Expression(derived.skills[skill.id] ?? 0, advantage),
      detail: skill.id,
      ...(conditionNotes ? { conditionNotes } : {}),
    };
  }

  if (args.kind === "saving_throw" || args.kind === "ability_check") {
    if (!sheet) {
      return { error: `${args.kind} needs a valid characterId from GAME STATE.` };
    }
    if (!args.ability) {
      return { error: `${args.kind} needs an ability (str, dex, con, int, wis, cha).` };
    }
    const derived = computeSheetDerived(sheet);
    const modifier =
      args.kind === "saving_throw"
        ? derived.saves[args.ability]
        : derived.abilityMods[args.ability];
    return {
      expression: d20Expression(modifier, advantage),
      detail: args.ability,
      ...(conditionNotes ? { conditionNotes } : {}),
    };
  }

  if (args.kind === "initiative") {
    if (!sheet) {
      return { error: "initiative needs a valid characterId from GAME STATE." };
    }
    const derived = computeSheetDerived(sheet);
    return {
      expression: d20Expression(derived.initiative, advantage),
      detail: "initiative",
      ...(conditionNotes ? { conditionNotes } : {}),
    };
  }

  // attack / damage / custom: the model supplies the expression (NPC stat
  // blocks live in its narration for now); the dice library enforces sanity.
  if (!args.expression) {
    return { error: `${args.kind} needs a dice expression like "1d20+4" or "2d6+2".` };
  }
  return { expression: args.expression, detail: args.reason?.slice(0, 60) ?? "" };
}

// Finds the sheet a model-supplied character reference points at: exact id
// first, then case-insensitive name (models often send names).
export function resolveSheetRef(
  requested: string | undefined,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): CharacterSheet | null {
  const trimmed = (requested ?? "").trim();
  if (!trimmed) {
    return null;
  }
  return (
    sheetsById.get(trimmed) ??
    sheets.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase()) ??
    null
  );
}
