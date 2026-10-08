import { LUCK_SPEND } from "@/lib/dm/roll-riders";
import { luckPointsLeft } from "@/lib/srd/class-resources";
import { actorAdvantage, featCheckRider, hasSkulker } from "@/lib/srd/feat-combat";
import { d20Expression, type Advantage } from "@/lib/dice";
import {
  exhaustionRollState,
  mergeAdvantage,
  rollDerivation,
  wearsHeavyArmor,
} from "@/lib/dm/condition-logic";
import { heldHelp } from "@/lib/dm/help-logic";
import { encumbranceCovers, encumbranceFor } from "@/lib/srd/encumbrance";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import {
  defenseRiders,
  halfProficiencyCovers,
  hasHalflingLuck,
} from "@/lib/srd/feature-effects";
import { strengthCheckFloor } from "@/lib/srd/trait-rules";
import { computeAbilityScore, INSPIRATION_SPEND, toolProficiencyBonus } from "@/lib/dm/roll-riders";
import { rollFeatureRiders } from "@/lib/dm/roll-feature-riders";
import type { RollArgs } from "@/lib/dm/roll-args";
import { DM_TOOL_NAME_PATTERN, toolTextRegex, xmlToolCallRegex } from "@/lib/dm/tool-text";
import { acBreakdownFor, computeSheetDerived, findSkill, SRD_SKILLS } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { StreamedToolCall } from "@/lib/model-client";
import { senseCheckFailure } from "@/lib/srd/sense-checks";
import { sightRotPenalty } from "@/lib/srd/afflictions";

export { rollArgsSchema, rollDcFor, type RollArgs } from "@/lib/dm/roll-args";

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
  // Context this pure module cannot read itself: an ally's aura covering
  // the roller (dm/aura.ts, saving throws only) and the table's optional
  // encumbrance rule. Callers with campaign access pass them; test doubles
  // and modifier-only callers omit them.
  extras?: {
    saveBonus?: number;
    saveNote?: string;
    encumbrance?: boolean;
    // Active effects riding on the roller for THIS kind of roll
    // (src/lib/dm/effects-logic.ts). Passed in for the same reason the aura
    // is: this module is pure and cannot read the effect table itself. The
    // caller has already resolved the stack, so the advantage flags here are
    // post-cancellation and simply join the merge below.
    effectBonus?: number;
    effectNote?: string;
    effectAdvantage?: boolean;
    effectDisadvantage?: boolean;
    // A drow with Sunlight Sensitivity standing in direct sunlight
    // (src/lib/dm/sunlight.ts): disadvantage on Perception by sight.
    sunlight?: boolean;
    // Standing in an obscured spell area (src/lib/dm/zone-rules.ts): the same.
    obscured?: string | null;
    // The roller moved no more than half their speed this turn (Supreme
    // Sneak, src/lib/srd/check-traits.ts); the caller reads the board.
    movedLittle?: boolean;
  },
):
  | {
      expression: string;
      detail: string;
      conditionNotes?: string[];
      // Condition name the caller must clear: an inspiration die was folded
      // into the expression and is now spent.
      spendInspiration?: string;
    }
  | { autoFail: true; detail: string; notes: string[] }
  | { error: string } {
  const derivationKind =
    args.kind === "skill_check" ||
    args.kind === "ability_check" ||
    args.kind === "saving_throw" ||
    args.kind === "initiative"
      ? args.kind
      : null;
  // A skill check is driven by the skill's own ability (Athletics is
  // Strength), which rage and other ability-keyed effects need to see.
  const skillAbility =
    args.kind === "skill_check"
      ? findSkill((args.skill ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"))?.ability
      : undefined;
  const derivationAbility = args.ability ?? skillAbility;
  // Rage gives nothing in heavy armor, its advantage on Strength included.
  const derivation =
    sheet && derivationKind
      ? rollDerivation(sheet.conditions, derivationKind, derivationAbility, {
          rageSuppressed: wearsHeavyArmor(sheet.equipment),
        })
      : { advantage: "none" as const, autoFail: false, notes: [] };
  if (derivation.autoFail) {
    return { autoFail: true, detail: args.ability ?? "", notes: derivation.notes };
  }
  // Blinded or deafened: a check that needs the lost sense fails (srd/sense-checks.ts).
  const senseless = sheet && (derivationKind === "skill_check" || derivationKind === "ability_check") ? senseCheckFailure(sheet.conditions, { reason: args.reason }) : null;
  if (senseless) {
    return { autoFail: true, detail: args.skill ?? args.ability ?? "", notes: [senseless] };
  }
  const exhaustion =
    sheet && derivationKind
      ? exhaustionRollState(sheet.exhaustion ?? 0, derivationKind)
      : { advantage: "none" as const, note: null };
  // A held Help die: the ally's assistance gives advantage on the next
  // check, and is spent by taking it (src/lib/dm/action-tools.ts).
  // Help is for an ability check or an attack roll, never a saving throw,
  // which leaves the held Help where it is for the roll it was given for.
  const helped =
    sheet && derivationKind && derivationKind !== "initiative" && derivationKind !== "saving_throw"
      ? heldHelp(sheet, { check: true })
      : null;
  // Feature-driven roll riders: Reliable Talent floors a proficient check,
  // Jack of All Trades adds half proficiency.
  const defense =
    sheet && sheet.class
      ? defenseRiders({ class: sheet.class, level: sheet.level, features: sheet.features })
      : { saveAdvantage: new Set<string>(), halfProficiency: null };
  // Halfling Lucky: attacks, checks, and saves reroll a natural 1 once. It
  // rides the leading d20 term as the grammar's "r1" reroll suffix (placed
  // before any Reliable Talent floor, which raises the surviving face).
  const lucky = sheet && derivationKind ? hasHalflingLuck(sheet) : false;
  // Lucky's point: an extra d20 in the pool, the best kept, whatever the
  // advantage (the feat lets them choose among all the dice).
  const luckPoint = Boolean(args.luck) && sheet !== null && sheet !== undefined && derivationKind !== null && luckPointsLeft(sheet.resources) > 0;
  const withLuck = (expression: string) =>
    luckPoint ? expression.replace(/^(\d+)d20(?:k[hl]\d+)?/, (_, count) => `${Number(count) + 1}d20kh1`) : expression;
  // The features, traits, items and held dice that ride this roll
  // (src/lib/dm/roll-feature-riders.ts).
  const riders = rollFeatureRiders(sheet, args, {
    kind: derivationKind,
    ability: derivationAbility,
    movedLittle: extras?.movedLittle,
  });
  if ("error" in riders) {
    return riders;
  }
  // What the character is wearing, for the armor rules below. Test doubles
  // and partial sheets without equipment skip these.
  const wornBreakdown =
    sheet && sheet.class && Array.isArray(sheet.equipment) && derivationKind
      ? acBreakdownFor(sheet)
      : null;
  // SRD: armor worn without training = disadvantage on every STR- or
  // DEX-based ability check, skill check, and saving throw.
  const armorUntrained =
    Boolean(wornBreakdown?.unproficient) &&
    (derivationAbility === "str" || derivationAbility === "dex");
  // Variant: Encumbrance. Past 10x Strength in pounds every physical roll
  // is at disadvantage; the pack is weighed from the sheet, and the table's
  // rule switch is the one thing the caller has to supply.
  const load =
    extras?.encumbrance && sheet && derivationKind
      ? encumbranceFor({
          strength: sheet.abilities.str,
          equipment: sheet.equipment ?? [],
          coins: sheet.gold ?? 0,
        })
      : null;
  const overloaded =
    Boolean(load?.disadvantage) && encumbranceCovers(derivationAbility ?? null);
  // Effect conditions (bless, bane, guidance, haste...) add their dice and
  // advantage to the holder's own rolls; one-shot riders land in `spent`.
  const effectKind =
    derivationKind === "saving_throw"
      ? ("save" as const)
      : derivationKind === "skill_check" || derivationKind === "ability_check"
        ? ("check" as const)
        : derivationKind === "initiative"
          ? ("initiative" as const)
          : null;
  const effects =
    sheet && effectKind
      ? conditionRollRiders(
          sheet.conditions,
          effectKind,
          derivationAbility,
          // Pass without Trace's +10 rides Stealth checks only.
          derivationKind === "skill_check" ? findSkill((args.skill ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"))?.id : undefined,
        )
      : { diceSuffix: "", advantageSources: [], notes: [], spent: [] };
  const advantage: Advantage = mergeAdvantage([
    args.advantage ?? "none",
    ...(extras?.effectAdvantage ? ["advantage" as const] : []),
    ...(extras?.effectDisadvantage ? ["disadvantage" as const] : []),
    derivation.advantage,
    exhaustion.advantage,
    ...effects.advantageSources,
    ...(helped ? ["advantage" as const] : []),
    ...riders.advantageSources,
    ...(armorUntrained ? ["disadvantage" as const] : []),
    ...(overloaded ? ["disadvantage" as const] : []),
  ]);
  const bonusDie = `${riders.dice}${effects.diceSuffix}`;
  // All one-shot carriers are spent the same way: the caller clears them.
  const spent = [
    riders.inspirationCondition,
    riders.peerless,
    helped,
    ...effects.spent,
    ...riders.authoredSpent,
    riders.inspired ? INSPIRATION_SPEND : null,
  ].filter(Boolean) as string[];
  const carriersSpent = [...spent, ...(luckPoint ? [LUCK_SPEND] : [])];
  const inspirationFields = carriersSpent.length ? { spendInspiration: carriersSpent.join("|") } : {};

  const allNotes = [
    ...derivation.notes,
    ...(exhaustion.note ? [exhaustion.note] : []),
    ...riders.inspirationNotes,
    ...effects.notes,
    ...(helped ? ["spends the Help their ally gave them: advantage"] : []),
    ...riders.notes,
    ...(armorUntrained
      ? ["wearing armor they are not trained in: disadvantage on STR and DEX rolls"]
      : []),
    ...(overloaded && load?.note ? [load.note] : []),
    ...(lucky ? ["Lucky: a natural 1 on the d20 is rerolled once"] : []),
    ...(luckPoint ? ["Lucky: a luck point buys an extra d20, the best kept"] : []),
  ];
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
    // Reliable Talent: a proficient check treats a d20 face of 9 or lower
    // as a 10, via the dice engine's floor suffix.
    const proficientSkill =
      sheet.proficiencies.skills.includes(skill.id) ||
      (sheet.proficiencies.expertise ?? []).includes(skill.id);
    const reliable =
      proficientSkill &&
      Boolean(
        (defense as { reliableTalent?: boolean }).reliableTalent,
      );
    // Worn armor tagged noisy (scale, plate...) imposes disadvantage on
    // Stealth checks; the AC breakdown already knows what is worn.
    const armorStealth = skill.id === "stealth" && Boolean(wornBreakdown?.stealthDisadvantage);
    const sunlit = skill.id === "perception" && Boolean(extras?.sunlight);
    // Skulker: dim light costs their Perception nothing (feat-combat.ts).
    const veiledBy = skill.id === "perception" ? (extras?.obscured ?? null) : null;
    const veiled = veiledBy && hasSkulker(sheet) && /dim light/i.test(veiledBy) ? null : veiledBy;
    // Actor: advantage on Deception and Performance while passing as
    // someone else, read from the check's reason.
    const acting = actorAdvantage(sheet, skill.id, args.reason);
    // The other feats' check riders: an expertise die, an advantage, a
    // doubled proficiency (src/lib/srd/feat-combat.ts).
    const featRider = featCheckRider(sheet, skill.id, args.reason);
    const finalAdvantage = mergeAdvantage([
      advantage,
      ...(armorStealth || sunlit || veiled ? ["disadvantage" as const] : []),
      ...(acting || featRider?.advantage ? ["advantage" as const] : []),
    ]);
    // A skill check is an ability check: a lasting effect on checks counts,
    // and so does an item that rides checks.
    const skillEffect = (extras?.effectBonus ?? 0) + riders.checkBonus;
    // Variant, Skills with Different Abilities (SRD 5.1): a Constitution
    // (Athletics) check keeps the Athletics proficiency and takes the
    // Constitution modifier in place of Strength's.
    const checkAbility = args.ability ?? skill.ability;
    const abilitySwap =
      checkAbility !== skill.ability
        ? (derived.abilityMods[checkAbility] ?? 0) - (derived.abilityMods[skill.ability] ?? 0)
        : 0;
    // Sight rot: its penalty rides the checks that rely on sight.
    const sightRot = skill.id === "perception" || skill.id === "investigation" ? sightRotPenalty(sheet.conditions) : 0;
    const featProficiency =
      featRider?.expertise && !proficientSkill ? 2 * derived.proficiencyBonus : featRider?.expertise && !(sheet.proficiencies.expertise ?? []).includes(skill.id) ? derived.proficiencyBonus : 0;
    const skillModifier = (derived.skills[skill.id] ?? 0) + abilitySwap + skillEffect - sightRot + featProficiency;
    // Indomitable Might: a Strength check never totals below the score.
    const mightFloor =
      checkAbility === "str"
        ? strengthCheckFloor(sheet, computeAbilityScore(sheet, "str"), skillModifier)
        : null;
    const floor = Math.max(reliable ? 10 : 0, mightFloor ?? 0);
    // Reroll (Lucky) comes before floor (Reliable Talent): the 1 is rerolled,
    // then the surviving face is raised to 10 if still low.
    const d20Mods = `${lucky ? "r1" : ""}${floor > 1 ? `f${floor}` : ""}`;
    const base = withLuck(d20Expression(skillModifier, finalAdvantage)).replace(
      /^(\d+d20(?:k[hl]\d+)?)/,
      `$1${d20Mods}`,
    );
    const skillNotes = [
      ...(conditionNotes ?? []),
      ...(sightRot ? [`sight rot: -${sightRot} on a check that relies on sight`] : []),
      ...(checkAbility !== skill.ability ? [`a ${checkAbility.toUpperCase()} (${skill.name}) check: ${checkAbility.toUpperCase()} in place of ${skill.ability.toUpperCase()}, the skill's proficiency kept`] : []),
      ...(reliable ? ["Reliable Talent: a d20 face below 10 counts as 10"] : []),
      ...(armorStealth ? ["their armor imposes disadvantage on Stealth"] : []),
      ...(acting ? ["Actor: advantage while passing as someone else"] : []),
      ...(featRider ? [featRider.note] : []),
      ...(veiledBy && !veiled ? ["Skulker: dim light costs their Perception nothing"] : []),
      ...(sunlit ? ["Sunlight Sensitivity: disadvantage on Perception in direct sunlight"] : []),
      ...(veiled ? [veiled] : []),
      ...(extras?.effectNote ? [extras.effectNote] : []),
    ];
    return {
      expression: `${base}${bonusDie}${featRider?.die ? `+${featRider.die}` : ""}`,
      detail: skill.id,
      ...(skillNotes.length ? { conditionNotes: skillNotes } : {}),
      ...inspirationFields,
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
    // Jack of All Trades / Remarkable Athlete: raw ability checks never
    // carry proficiency, so a covered ability always gets the half bonus.
    const halfScope =
      (defense as { halfProficiency?: "all" | "physical" | null }).halfProficiency ?? null;
    // Jack of All Trades rounds down; Remarkable Athlete (the physical
    // scope) rounds up.
    const halfBonus =
      args.kind === "ability_check" && halfProficiencyCovers(halfScope, args.ability)
        ? halfScope === "physical"
          ? Math.ceil(derived.proficiencyBonus / 2)
          : Math.floor(derived.proficiencyBonus / 2)
        : 0;
    const auraBonus = args.kind === "saving_throw" ? (extras?.saveBonus ?? 0) : 0;
    const effectBonus = extras?.effectBonus ?? 0;
    // A check made with a tool the character is trained in adds proficiency
    // (twice with expertise in it), in place of the half a bard would add.
    const tool =
      args.kind === "ability_check" && args.tool ? toolProficiencyBonus(sheet, args.tool, derived.proficiencyBonus) : null;
    const checkBonus =
      args.kind === "ability_check" ? (tool ? tool.bonus : halfBonus) + riders.checkBonus : 0;
    const modifier =
      (args.kind === "saving_throw"
        ? derived.saves[args.ability]
        : derived.abilityMods[args.ability]) +
      (args.kind === "saving_throw" ? halfBonus : checkBonus) +
      auraBonus +
      effectBonus;
    // Indomitable Might: a Strength check never totals below the score.
    const mightFloor =
      args.kind === "ability_check" && args.ability === "str"
        ? strengthCheckFloor(sheet, computeAbilityScore(sheet, "str"), modifier)
        : null;
    const abilityNotes = [
      ...(conditionNotes ?? []),
      ...(halfBonus && !tool ? [`half proficiency on ability checks: +${halfBonus}`] : []),
      ...(tool ? [tool.note] : []),
      ...(auraBonus && extras?.saveNote ? [extras.saveNote] : []),
      ...(extras?.effectNote ? [extras.effectNote] : []),
      ...(mightFloor ? ["Indomitable Might: the check totals at least their Strength score"] : []),
    ];
    const luckyBase = withLuck(d20Expression(modifier, advantage)).replace(
      /^(\d+d20(?:k[hl]\d+)?)/,
      `$1${lucky ? "r1" : ""}${mightFloor ? `f${mightFloor}` : ""}`,
    );
    return {
      expression: `${luckyBase}${bonusDie}`,
      detail: args.ability,
      ...(abilityNotes.length ? { conditionNotes: abilityNotes } : {}),
      ...inspirationFields,
    };
  }

  if (args.kind === "initiative") {
    if (!sheet) {
      return { error: "initiative needs a valid characterId from GAME STATE." };
    }
    const derived = computeSheetDerived(sheet);
    // A lasting effect on initiative (Gift of Alacrity) adds to the roll.
    const initiativeEffect = extras?.effectBonus ?? 0;
    const luckyBase = withLuck(d20Expression(derived.initiative + initiativeEffect, advantage)).replace(
      /^(\d+d20(?:k[hl]\d+)?)/,
      lucky ? "$1r1" : "$1",
    );
    const initiativeNotes = [
      ...(conditionNotes ?? []),
      ...(extras?.effectNote ? [extras.effectNote] : []),
    ];
    return {
      expression: `${luckyBase}${effects.diceSuffix}`,
      detail: "initiative",
      ...(initiativeNotes.length ? { conditionNotes: initiativeNotes } : {}),
      ...inspirationFields,
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
