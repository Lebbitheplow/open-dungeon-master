// The Multiattack routine a block prints, read into the attacks a creature
// makes on its turn (SRD 5.1, Monsters: Actions): which attacks and how many,
// the alternatives a turn chooses among, a swing made only if the one before
// it hit, and the count when the routine names no attack the block prints.
// Pure; read by statblock.ts when a pack row becomes a stored block, beside
// attack-text.ts, which reads each attack's own line.

import { textKey } from "@/lib/language/text-logic";
import { pluralForms } from "@/lib/srd/name-forms";

// `ifHit`: the step is made only when the swing before it hit ("If that
// attack hits, the grick can make one beak attack against the same target").
// `dice`: the count is rolled each turn ("makes 1d4 Rotting Touch attacks",
// a violet fungus); `count` is then its average, for whatever only plans.
export type RoutineStep = { attack: string; count: number; ifHit?: boolean; dice?: string };

const COUNTS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "Bite (Bat or Vampire Form Only)" -> "bite", "+1 Longsword" -> "longsword".
const bareName = (name: string) => textKey(name.replace(/\([^)]*\)/g, "").replace(/^\s*[+-]\d+\s+/, ""));

// The attack a routine names: its whole bare name, or the same name with
// either side plural ("claws" is Claw, "talon" is Talons). A word of a name
// is none ("tail" is no Tail Spike).
function matchAttack(word: string, names: string[]): string | null {
  const wanted = textKey(word.replace(/^(?:its|his|her|their)\s+/i, ""));
  return (
    names.find((name) => bareName(name) === wanted) ??
    names.find((name) => pluralForms(bareName(name)).includes(wanted) || pluralForms(wanted).includes(bareName(name))) ??
    null
  );
}

export const COUNT_WORD = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})";

// A word of an action's name, never the wording around it ("uses Grasp of
// Shadows then attacks ... twice" names no action used twice).
const NAME_WORD = "(?!(?:then|and|or|with|attacks?)\\b)[\\p{L}\\p{M}\\p{N}'’-]+";

// An item that names a count of attacks: "two claw attacks", "one with its
// tail", "two melee attacks with its claws"; not "one leg attack per leg",
// whose count the block does not fix.
export const ATTACK_GROUP = new RegExp(
  `^(?!a\\s+number\\b)(${COUNT_WORD})\\s+(?:(?:[\\p{L}\\p{M}\\p{N}'’-]+\\s+){0,6}?attacks?\\b(?!\\s+(?:for\\s+each|per)\\b)|(?:[\\p{L}\\p{M}\\p{N}'’-]+\\s+){0,2}?with\\s+(?:its|his|her|their)\\s)`,
  "iu",
);

// One "one with its bite" / "two claw attacks" / "two with its claws" /
// "one to constrict".
function stepOf(item: string, names: string[]): RoutineStep | null {
  const text = item.trim().replace(/[.]$/, "");
  const withIts = new RegExp(`^(${COUNT_WORD})\\s+(?:\\w+\\s+)?(?:attacks?\\s+)?with\\s+(?:its|his|her|their)\\s+(.+)$`, "i").exec(text);
  const named = new RegExp(`^(${COUNT_WORD})\\s+(.+?)\\s+attacks?$`, "i").exec(text);
  const toVerb = new RegExp(`^(${COUNT_WORD})\\s+to\\s+(\\w+)$`, "i").exec(text);
  const found = withIts ?? named ?? toVerb;
  if (!found) {
    return null;
  }
  const count = COUNTS[found[1].toLowerCase()] ?? Number(found[1]);
  const attack = matchAttack(found[2], names);
  return attack && count >= 1 ? { attack, count } : null;
}

// "one with its claws or harpoon" -> "one with its claws", "one with its
// harpoon", and "two Wind Lash or Lightning Bolt attacks" -> "two Wind Lash
// attacks", "two Lightning Bolt attacks": a step that lets the creature pick
// the attack.
function stepChoices(item: string): string[] {
  const choice = /^(.*?\b(?:its|his|her|their)\s+)(.+?)\s+or\s+(?:with\s+)?(?:its\s+)?(.+)$/i.exec(item.trim());
  if (choice) {
    return [`${choice[1]}${choice[2]}`, `${choice[1]}${choice[3]}`];
  }
  const named = /^(\S+)\s+(.+?)\s+or\s+(.+?)\s+(attacks?)$/i.exec(item.trim());
  return named ? [`${named[1]} ${named[2]} ${named[4]}`, `${named[1]} ${named[3]} ${named[4]}`] : [item];
}

// Every routine a list of items allows: each item with a choice of attack
// multiplies the routines. A routine naming an attack the block does not
// have is left out.
function routinesOfList(body: string, names: string[]): RoutineStep[][] {
  const items = body.split(/,\s*(?:and\s+)?|\s+and\s+/).map((item) => item.trim()).filter(Boolean);
  let routines: RoutineStep[][] = [[]];
  for (const item of items) {
    const steps = stepChoices(item).map((choice) => stepOf(choice, names));
    if (steps.every((step) => step === null)) {
      return [];
    }
    routines = routines.flatMap((routine) =>
      steps.filter((step): step is RoutineStep => step !== null).map((step) => [...routine, step]),
    );
  }
  return routines.filter((routine) => routine.length);
}

// The routines the groups a "makes" lists allow: "three claw attacks and
// one bite attack." is Claw x3 and Bite, and "one claw and one bite attack"
// the same with the noun said once, up to an item that is no count ("each
// of which it can replace with one use of Fling"). None when a count names
// no attack of the block ("two Heavy Pick attacks" on a block whose attack
// is War Pick, "as many leg attacks as it has legs"): a routine short of a
// group would plan too few swings.
function listedRoutines(clause: string, names: string[]): RoutineStep[][] {
  let routines: RoutineStep[][] = [[]];
  for (const item of multiattackItems(clause)) {
    const steps = stepChoices(item)
      .map((choice) => stepOf(choice, names) ?? stepOf(`${choice} attack`, names))
      .filter((step): step is RoutineStep => step !== null);
    if (!steps.length) {
      if (new RegExp(`^(?:${COUNT_WORD}|as many)\\s`, "i").test(item)) {
        return [];
      }
      break;
    }
    routines = routines.flatMap((routine) => steps.map((step) => [...routine, step]));
  }
  return routines.filter((routine) => routine.length);
}

// What a "makes" lists, up to what else the turn does ("uses its Frightful
// Presence"), split into its alternatives at an "or" that opens another
// count ("two claw attacks or one claw and one bite attack").
export function multiattackAlternatives(clause: string): string[] {
  // "makes one bite attack and, if it can, uses its Blinding Spittle" (a
  // gibbering mouther) lists the bite alone.
  const listed = clause
    .split(/,?\s*(?:(?:and|or),?\s+)?(?:if (?:it|he|she|they) can,\s+)?(?:then\s+)?\b(?:uses?|can|casts?)\b/i)[0]
    .replace(new RegExp(`(\\battacks?)\\s+or\\s+(?!${COUNT_WORD}\\s).*$`, "i"), "$1");
  return listed.split(new RegExp(`\\s+or\\s+(?=${COUNT_WORD}\\s)`, "i"));
}

// The items of one alternative: "three claw attacks and one bite attack",
// "two thorn vine attacks plus one...", "a claws attack and then either a
// bite or longsword attack".
export function multiattackItems(alternative: string): string[] {
  return alternative
    .replace(/[.,;:\s]+$/, "")
    .split(/,\s*(?:and\s+)?|\s+(?:and|plus)\s+/)
    .map((item) => item.trim().replace(/^(?:then\s+)?(?:either\s+)?/i, "").replace(/\s+(?:against|if|in place of|instead of)\s.*$/i, ""))
    .filter(Boolean);
}

// The sentence cut at each "or" that opens another "makes" (", or it makes
// two Rune Blast attacks", "or he makes three Fist attacks", "or it can cast
// one spell and make one..."): each part is one way to spend the turn.
export function multiattackParts(sentence: string): string[] {
  return sentence.split(/,?\s+or\s+(?=(?:[\p{L}\p{M}'’-]+\s+){0,4}?(?:makes?|casts?)\b)/iu);
}

// The printed wording made regular: "(humanoid form)" notes dropped, the
// medusa's dashes ("makes either three melee attacks - A and B - or two
// ranged attacks") read as a list and its alternative, and "or uses its
// Hurl Flame twice" (the efreeti) as "or makes two Hurl Flame attacks",
// "two slam attacks, two stomp attacks, or one of each" as its two
// alternatives, and a line that opens on its count ("Three Pitchfork
// attacks or...") as made; cut into sentences.
// A5e's way of saying it: "attacks once with its bite and twice with its
// claws", "attacks three times with its tentacle", "attacks with its horns
// and its claws", "attacks twice".
const TIMES: Record<string, string> = { once: "one", twice: "two", thrice: "three", "three times": "three", "four times": "four", "five times": "five", "six times": "six" };
const TIMES_WORD = "once|twice|thrice|three times|four times|five times|six times";

function a5eMultiattack(text: string): string {
  // "attacks" the verb, never the noun of "makes two attacks with its claws".
  const verb = `(?<!\\b(?:${COUNT_WORD}|melee|ranged|weapon|spell|its|his|her|their)\\s)\\battacks`;
  return text
    .replace(new RegExp(`${verb}\\s+(${TIMES_WORD})\\s+with\\s+(its|his|her|their)\\s`, "gi"), (_, times: string, its: string) => `makes ${TIMES[times.toLowerCase()]} attack${times.toLowerCase() === "once" ? "" : "s"} with ${its} `)
    .replace(new RegExp(`${verb}\\s+with\\s+(its|his|her|their)\\s`, "gi"), (_, its: string) => `makes one attack with ${its} `)
    .replace(new RegExp(`\\band\\s+(${TIMES_WORD})\\s+with\\s+(its|his|her|their)\\s`, "gi"), (_, times: string, its: string) => `and ${TIMES[times.toLowerCase()]} attack${times.toLowerCase() === "once" ? "" : "s"} with ${its} `)
    .replace(/(\bmakes one attack with (?:its|his|her|their) [^.,;]+?) and (its|his|her|their) /gi, "$1 and one attack with $2 ")
    .replace(new RegExp(`${verb}\\s+(${TIMES_WORD})(?=\\s*[.;]|$)`, "gi"), (_, times: string) => `makes ${TIMES[times.toLowerCase()]} attacks`);
}

// Tome of Beasts 3 names its attacks with no noun and often no verb: "Three
// Claws.", "One Bite and two Kicks or three Spit Worms.", "Uses its
// Frightful Presence then one Bite and two Claws." Each count before a
// capitalized name is that many of the attack so named.
// The count in either case, the name only capitalized.
const ANY_CASE_COUNT = "(?:[Aa]n?|[Oo]ne|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive|[Ss]ix|[Ss]even|[Ee]ight|[Nn]ine|[Tt]en|\\d{1,2})";

function namedCounts(text: string): string {
  return text
    .replace(new RegExp(`\\bthen\\s+(?=${COUNT_WORD}\\s)`, "gi"), "then makes ")
    .replace(new RegExp(`\\b(${ANY_CASE_COUNT})\\s+((?:[A-Z][\\p{L}'’-]*)(?:\\s+[A-Z][\\p{L}'’-]*)*)(?!\\s+attacks?\\b)(?=\\s*(?:[,.;]|\\s(?:or|and|plus)\\s|$))`, "gu"), "$1 $2 attacks");
}

export function multiattackSentences(desc: string): string[] {
  return namedCounts(a5eMultiattack(desc.replace(/\s+/g, " ").trim()))
    .replace(new RegExp(`^(?=${COUNT_WORD}\\s)`, "i"), "makes ")
    .replace(/(^|[.;]\s+)(?=(?:[Oo]ne|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive|[Ss]ix)\s+[A-Z])/g, "$1makes ")
    .replace(new RegExp(`(\\battacks?),\\s+(?=${COUNT_WORD}\\s[^.,;]*?attacks?,?\\s+or\\s+one of each\\b)`, "gi"), "$1 or ")
    .replace(/,?\s+or\s+one of each\b/gi, "")
    .replace(new RegExp(`\\buses\\s+(?:its\\s+)?((?:${NAME_WORD}\\s+){0,3}${NAME_WORD})\\s+(twice|three times)\\b`, "giu"), (_, name: string, times: string) =>
      `makes ${times === "twice" ? "two" : "three"} ${name} attacks`,
    )
    .replace(/\s*\([^)]*\bform\)/gi, "")
    .replace(/\bmakes either\b/gi, "makes")
    .replace(/\s+-\s+or\s+/g, " or ")
    .replace(/\s+-\s+/g, ": ")
    .split(/(?<=[.;])\s+/);
}

// The routines of a Multiattack that limits its attacks rather than listing
// them (SRD 5.1): "makes two attacks, only one of which can be a bite" (a
// vampire, a wererat; "with its tusks", a wereboar) is two of any other
// attack, or one fewer and the bite; "makes two melee attacks, each one
// with a different weapon" (a lizardfolk) is two attacks of different
// names; "makes 1d4 Rotting Touch attacks" (a violet fungus) rolls its count.
// Null when the part says none of these, empty when it names no attack of
// the block.
function limitedRoutines(part: string, attackNames: string[]): RoutineStep[][] | null {
  const onlyOne = new RegExp(`makes?\\s+(${COUNT_WORD})\\s+(?:\\w+\\s+)?attacks?,?\\s+only one of which can be (?:an?\\s+|with\\s+(?:its|his|her|their)\\s+)?([\\w ]+?)(?:\\s+attack)?\\.?$`, "i").exec(part);
  if (onlyOne) {
    const count = countOf(onlyOne[1]);
    const once = matchAttack(onlyOne[2], attackNames);
    const others = attackNames.filter((name) => name !== once);
    if (!once || !others.length || count < 2) {
      return [];
    }
    return [...others.map((other) => [{ attack: other, count }]), ...others.map((other) => [{ attack: other, count: count - 1 }, { attack: once, count: 1 }])];
  }
  const different = new RegExp(`makes?\\s+(${COUNT_WORD})\\s+(?:\\w+\\s+)?attacks?,?\\s+each(?:\\s+one)?\\s+with\\s+a\\s+different\\s+weapon\\.?$`, "i").exec(part);
  if (different) {
    const count = countOf(different[1]);
    if (count < 2 || attackNames.length < count) {
      return [];
    }
    return attackNames.map((_, start) => Array.from({ length: count }, (__, step) => ({ attack: attackNames[(start + step) % attackNames.length], count: 1 })));
  }
  const rolled = /makes?\s+(\d{1,2})d(\d{1,2})\s+(.+?)\s+attacks?\.?$/i.exec(part);
  if (rolled) {
    const attack = matchAttack(rolled[3], attackNames);
    const [dice, faces] = [Number(rolled[1]), Number(rolled[2])];
    return attack ? [[{ attack, count: Math.max(1, Math.floor((dice * (faces + 1)) / 2)), dice: `${dice}d${faces}` }]] : [];
  }
  return null;
}

// The routines a Multiattack line names, first the main one, then any "Or
// it makes..." alternative. Null when a group it lists names no attack of
// the block ("makes two melee attacks", "two Necrotic Blast attacks" beside
// a Necrotic Burst), which leaves the count to parseMultiattackCount: a
// routine read past an unreadable group would plan the wrong swings.
export function parseRoutines(desc: string, attackNames: string[]): RoutineStep[][] | null {
  const routines: RoutineStep[][] = [];
  let unread = false;
  for (const sentence of multiattackSentences(desc)) {
    const also = /can also make (a|an|one|two) ([\w ]+?) attacks?/i.exec(sentence);
    const ifHit = /if that attack hits,[^.]*?can make (a|an|one|two) ([\w ]+?) attacks?/i.exec(sentence);
    if ((also || ifHit) && routines.length) {
      // "If it has a shortsword drawn, it can also make a shortsword attack."
      // "If that attack hits, the grick can make one beak attack."
      const found = (ifHit ?? also)!;
      const step = stepOf(`${found[1]} ${found[2]} attack`, attackNames);
      if (step) {
        routines[routines.length - 1] = [...routines[routines.length - 1], ifHit ? { ...step, ifHit: true } : step];
      }
      continue;
    }
    if (/^if\b/i.test(sentence)) {
      // "If both Mace attacks hit one creature...", "If the commander is
      // mounted, its mount can then make one Hooves attack": what follows
      // the routine, not another one.
      continue;
    }
    for (const part of multiattackParts(sentence)) {
      const limits = limitedRoutines(part, attackNames);
      if (limits) {
        unread ||= !limits.length;
        routines.push(...limits);
        continue;
      }
      const listed = new RegExp(`makes?\\s+${COUNT_WORD}\\s+(?:\\w+\\s+)?attacks?\\s*:\\s*(.+)$`, "i").exec(part);
      const either = new RegExp(
        `makes?\\s+(${COUNT_WORD})\\s+(?:\\w+\\s+)?attacks?,?\\s+either\\s+with\\s+(?:its|his|her|their)\\s+([\\w ]+?)\\s+or\\s+(?:with\\s+)?(?:its|his|her|their)\\s+([\\w ]+?)\\.?$`,
        "i",
      ).exec(part);
      if (listed) {
        // "two attacks: one with its pike and one with its hooves or two with
        // its longbow": an " or " before a count opens another routine.
        for (const alternative of listed[1].split(new RegExp(`\\s+or\\s+(?=${COUNT_WORD}\\s)`, "i"))) {
          const found = routinesOfList(alternative, attackNames);
          unread ||= !found.length;
          routines.push(...found);
        }
        continue;
      }
      if (either) {
        // "three attacks, either with its longsword or its longbow".
        for (const name of [either[2], either[3]]) {
          const step = stepOf(`${either[1]} with its ${name}`, attackNames);
          unread ||= !step;
          if (step) {
            routines.push([step]);
          }
        }
        continue;
      }
      // "makes three claw attacks and one bite attack", "makes four attacks
      // with its tendrils, uses Reel, and makes one attack with its bite":
      // every group each "makes" lists, up to what else the turn does.
      // Each alternative of a single "makes" is a routine of its own; two
      // "makes" in one part are one routine.
      const made = part
        .split(/\bmakes?\s+/i)
        .slice(1)
        .filter((clause) => ATTACK_GROUP.test(multiattackItems(clause)[0] ?? ""))
        .map((clause) => multiattackAlternatives(clause).map((alternative) => listedRoutines(alternative, attackNames)));
      if (made.flat().some((found) => !found.length)) {
        unread = true;
      } else if (made.length === 1) {
        routines.push(...made[0].flat());
      } else if (made.length) {
        routines.push(made.flatMap((alternatives) => alternatives[0][0]));
      }
    }
  }
  return routines.length && !unread ? routines : null;
}

const MULTIATTACK_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
// The same ceiling enemy-attack.ts holds a turn to: a guard against a
// corrupt block, well above any SRD creature (the tarrasque makes five).
const MAX_MULTIATTACK = 10;

function countOf(word: string): number {
  const lower = word.toLowerCase();
  return MULTIATTACK_WORDS[lower] ?? (lower === "a" || lower === "an" || lower === "one" ? 1 : Number(lower));
}

// "The wolf makes two bite attacks." -> 2. As many as the stat block says
// (SRD 5.1, Multiattack): "makes five attacks" is five swings, "makes two
// attacks: ..." two, and "makes three claw attacks and one bite attack"
// four: every group the first way to spend the turn lists, through each
// "makes" in it ("makes four attacks with its tendrils, uses Reel, and makes
// one attack with its bite" is five), up to an alternative ("or two ranged
// attacks", ", or it makes..."), and a "can also make" extra. The hydra's
// "as many bite attacks as it has heads" reads as the five heads it starts
// with.
export function parseMultiattackCount(description: string): number | null {
  if (/as many [^.]*attacks? as it has heads/i.test(description)) {
    return 5;
  }
  const sentences = multiattackSentences(description);
  const first = sentences.find((sentence) => /\bmakes?\s/i.test(sentence));
  if (!first) {
    return null;
  }
  const header = new RegExp(`\\bmakes?\\s+(${COUNT_WORD})\\s+(?:\\w+\\s+)?attacks?\\s*:`, "i").exec(first);
  let count = header ? countOf(header[1]) : 0;
  // The first part that makes attacks: "can either use Drift Backward or
  // make two attacks" is two.
  for (const part of header ? [] : multiattackParts(first)) {
    for (const clause of part.split(/\bmakes?\s+/i).slice(1)) {
      // "two rapier or two shortbow attacks": the noun said once, for both.
      const [alternative, ...others] = multiattackAlternatives(clause);
      const listed = others.length && !/\battacks?\b/i.test(alternative) ? `${alternative} attacks` : alternative;
      for (const item of multiattackItems(listed)) {
        const group = ATTACK_GROUP.exec(item);
        if (!group) {
          break;
        }
        count += countOf(group[1]);
      }
    }
    if (count) {
      break;
    }
  }
  for (const sentence of sentences) {
    const also = /can also make (a|an|one|two)\b[^.]*?attacks?/i.exec(sentence);
    count += also ? countOf(also[1]) : 0;
  }
  return count >= 2 ? Math.min(MAX_MULTIATTACK, count) : null;
}

// The swings one Attack action holds and the routines that spend them, as
// the enemy reader stores a block (statblock.ts) and the creature table
// writes a form (scripts/generate-srd-creatures.mjs), so a creature fought
// and the same creature shaped into attack alike: the count the line
// prints, else its first routine's swings (a gibbering mouther's one bite
// beside its Blinding Spittle, a violet fungus's 1d4 at their average), else
// two.
export function multiattackOf(desc: string, attackNames: string[]): { perTurn: number; routines: RoutineStep[][] | null } {
  const routines = parseRoutines(desc, attackNames);
  const perTurn = parseMultiattackCount(desc) ?? (routines ? Math.max(1, routines[0].reduce((sum, step) => sum + step.count, 0)) : 2);
  return { perTurn, routines };
}
