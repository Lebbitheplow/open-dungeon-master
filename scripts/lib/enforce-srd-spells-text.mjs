// What the bundled SRD 5.1 rulebook (src/lib/rulebook/srd-5.1.json) prints
// for each spell, read from the page itself, for
// scripts/test-enforce-srd-spells.mjs. Nothing here is read from the engine:
// the suite holds the engine's answers up against these.
//
// A spell page opens with its level line ("*3rd-level evocation*",
// "*Evocation cantrip*", "(ritual)"), then Casting Time, Range, Components
// and Duration, the description, and "***At Higher Levels***".

const ABILITY = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
const TYPES = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
export const CONDITIONS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
];

// "1 action" is "action"; minutes and hours are minutes, as the engine's
// SpellFacts counts them (src/lib/srd/spell-facts.ts). Plant Growth's "1
// action or 8 hours" is an action.
function castingTime(text) {
  if (/^1 bonus action/i.test(text)) return "bonus";
  if (/^1 reaction/i.test(text)) return "reaction";
  if (/^1 action/i.test(text)) return "action";
  const span = /^(\d+)\s+(minute|hour)s?/i.exec(text);
  return span ? Number(span[1]) * (span[2].toLowerCase() === "hour" ? 60 : 1) : `unread: ${text}`;
}

// "Self (15-foot cone)" keeps the cone's 15 feet; a mile is 5280 feet.
function range(text) {
  const clean = text.toLowerCase();
  if (clean.startsWith("self")) {
    const area = /(\d+)-foot/.exec(clean);
    return area ? { kind: "self", areaFeet: Number(area[1]) } : { kind: "self" };
  }
  for (const kind of ["touch", "sight", "unlimited", "special"]) {
    if (clean.startsWith(kind)) return { kind };
  }
  const span = /^([\d,]+)\s*(feet|foot|miles?)/.exec(clean);
  return { kind: "feet", feet: Number(span[1].replace(/,/g, "")) * (/mile/.test(span[2]) ? 5280 : 1) };
}

const ROUNDS = { round: 1, minute: 10, hour: 600, day: 14400 };

export function readSpellPage(page) {
  const md = page.md;
  const head = md.split("\n").find((line) => line.trim()).trim();
  const levelled = /^\*([1-9])(?:st|nd|rd|th)-level\s+(\w+)(\s*\(ritual\))?\*$/i.exec(head);
  const cantrip = /^\*(\w+)\s+cantrip\*$/i.exec(head);
  const field = (label) => (new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.*)$`, "m").exec(md)?.[1] ?? "").trim();
  const components = field("Components");
  const letters = components.split("(")[0].toUpperCase();
  const open = components.indexOf("(");
  const material = open >= 0 ? components.slice(open + 1, components.lastIndexOf(")")).trim() : "";
  const durationText = field("Duration");
  const duration = durationText.toLowerCase().replace(/\.$/, "").replace(/^concentration,?\s*/, "").replace(/^up to\s+/, "");
  const lasts = /^(\d+|one)\s+(round|minute|hour|day)s?$/.exec(duration);
  const body = md.slice(md.indexOf("**Duration:**")).split("\n").slice(1).join("\n").trim();
  const split = body.search(/\*\*\*At Higher Levels\*\*\*/i);
  const desc = split >= 0 ? body.slice(0, split) : body;
  const higher = split >= 0 ? body.slice(split) : "";
  const save = /\b(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i.exec(desc);
  const damage = new RegExp(`(\\d+d\\d+)(?:\\s*\\+\\s*(\\d+))?\\s+(${TYPES})\\s+damage`, "i").exec(desc);
  const heal = /\bregains?\b[^.]{0,60}?(\d+d\d+)/i.exec(desc);
  const up = /\bincreases?\s+by\s+(\d+)d(\d+)\b[^.]*?for each slot level above (\d)/i.exec(higher);
  return {
    id: page.id,
    name: page.title,
    level: levelled ? Number(levelled[1]) : 0,
    school: (levelled?.[2] ?? cantrip?.[1] ?? "").toLowerCase(),
    ritual: Boolean(levelled?.[3]),
    castingTime: castingTime(field("Casting Time")),
    range: range(field("Range")),
    rangeText: field("Range"),
    verbal: /\bV\b/.test(letters),
    somatic: /\bS\b/.test(letters),
    material: /\bM\b/.test(letters),
    materialText: material,
    concentration: /^concentration/i.test(durationText),
    durationText,
    // Rounds the spell lasts, or null for instantaneous, until dispelled
    // and the rest that print no count.
    rounds: lasts ? (lasts[1] === "one" ? 1 : Number(lasts[1])) * ROUNDS[lasts[2]] : null,
    desc,
    higher,
    attack: /\b(melee|ranged) spell attack/i.exec(desc)?.[1]?.toLowerCase() ?? null,
    save: save ? ABILITY[save[1].toLowerCase()] : null,
    dice: damage ? damage[1] : null,
    damageType: damage ? damage[3].toLowerCase() : null,
    // "or half as much damage on a successful one"; Control Water's whirlpool
    // "takes half damage".
    half: /half as much damage|\bhalf damage\b/i.test(desc),
    healDice: heal ? heal[1] : null,
    upcast: up ? { count: Number(up[1]), sides: Number(up[2]), above: Number(up[3]) } : null,
    tiers: [...higher.matchAll(/\((\d+d\d+)\)/g)].map((match) => match[1]),
    conditions: CONDITIONS.filter((name) => new RegExp(`\\b${name}\\b`, "i").test(desc)),
    // "Each creature in a 10-foot radius", "each creature in the line",
    // "each creature within its area", "each creature under the cloud": one
    // casting reaches every creature the area holds.
    area: /\b(?:each|every) creature (?:in|within|under) (?:a|an|the|that|its)\b[^.]{0,80}?(?:sphere|cube|cone|line|cylinder|radius|area|square|cloud)\b|\beach creature in the (?:line|cone|area|cube|sphere|cylinder)\b/i.test(desc),
    // "you can target one additional creature for each slot level above 1st"
    moreTargets: /target one additional creature for each slot level above/i.test(higher),
  };
}

// The Spell Lists page: each class's list as { name, level }.
export function readSpellLists(page) {
  const lists = {};
  let klass = null;
  let level = null;
  for (const line of page.md.split("\n")) {
    const head = /^## (\w+) Spells/.exec(line);
    if (head) {
      klass = head[1].toLowerCase();
      lists[klass] = [];
      continue;
    }
    const tier = /^#### (?:Cantrips|(\d)\w\w Level)/.exec(line);
    if (tier) {
      level = tier[1] ? Number(tier[1]) : 0;
      continue;
    }
    const item = /^- (.+)$/.exec(line);
    if (item && klass) {
      lists[klass].push({ name: item[1].trim(), level });
    }
  }
  return lists;
}
