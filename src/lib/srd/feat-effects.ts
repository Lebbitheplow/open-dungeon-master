// What a feat changes on the sheet's numbers, read from ODM's feat catalog
// (src/lib/srd/authored-feats.json) and from sheet.feats.
//
// A feat taken in the builder or at a level-up is written to sheet.feats by
// name, and the engines that read features alone never saw it: an elf with
// Elven Accuracy rolled two dice, Actor left Charisma where it was, Tough
// added nothing. The numbers live here, pure, so the level-up route, the hit
// point rule and the speed rule each read the same answer.
import authoredFeatsJson from "@/lib/srd/authored-feats.json";
import type { Ability } from "@/lib/schemas/sheet";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_WORDS: Record<string, Ability> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

type AuthoredFeat = { name: string; prerequisite?: string; desc: string };
const FEATS = (authoredFeatsJson as { feats: AuthoredFeat[] }).feats;

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

function featRow(name: string): AuthoredFeat | null {
  const wanted = key(name);
  return FEATS.find((feat) => key(feat.name) === wanted) ?? null;
}

// A content pack feat with the same rules as one of ODM's, under another
// name (issue #147): Level Up's Attentive is Alert, its Hardy Adventurer
// is Tough. The engines read the twin as the feat they know. Only feats
// whose every benefit the engine applies is the same are listed; a near
// twin (Battle Caster's expertise die, Powerful Attacker's disadvantage)
// stays its own feat, and so does one whose name a class feature shares
// (Level Up's Skirmisher is Mobile, but the Scout ranger's feature is
// named Skirmisher and this table reads features too).
export const FEAT_TWINS: Record<string, string> = {
  attentive: "alert",
  intuitive: "observant",
  "hardy adventurer": "tough",
  "crossbow expertise": "crossbow expert",
  "power caster": "spell sniper",
  dungeoneer: "dungeon delver",
  "heavy armor expertise": "heavy armor master",
  tenacious: "resilient",
  "street fighter": "tavern brawler",
  "dual-wielding expert": "dual wielder",
  "rite master": "ritual caster",
  deflector: "defensive duelist",
  "primordial caster": "elemental adept",
  "stealth expert": "skulker",
  "shield focus": "shield master",
  "polearm savant": "polearm master",
  "guarded warrior": "sentinel",
  "rallying speaker": "inspiring leader",
  "keen intellect": "keen mind",
  thespian: "actor",
  athletic: "athlete",
  "mounted warrior": "mounted combatant",
  "medium armor expert": "medium armor master",
  "linguistics expert": "linguist",
  "heavily outfitted": "heavily armored",
  "moderately outfitted": "moderately armored",
  "lightly outfitted": "lightly armored",
  "weapons specialist": "weapon master",
  fortunate: "lucky",
  "mystical talent": "magic initiate",
  skillful: "skilled",
};

// ---- a table's workshop feats ----

// A feat written in the workshop is its author's, so what one does is read
// per table: the feat it runs as (a renamed copy of Sharpshooter, "Deadeye",
// runs as Sharpshooter) and its own text, whose effects the engines parse
// the way they parse a content pack's (feature-effects.ts). The server reads
// the table's authors' feats (src/lib/db/table-feats.ts, registered by
// src/lib/db/sheets.ts); the browser is handed the same (the campaign
// snapshot's `feats`, the builder's fetch). A name the engines already know
// is that feat, whoever wrote one called the same.
export type TableFeat = { runsAs?: string; desc: string };

let tableFeatReader: ((campaignId: string) => ReadonlyMap<string, TableFeat>) | null = null;

// The browser's, one map per table: two campaigns may each have a "Deadeye"
// that runs as something different, and what one table's DM forgot must
// stop there. A campaign's snapshot replaces its table's map whole; the
// builder adds the feats it reads one at a time to the table it builds for,
// or to the library's outside a campaign.
const LIBRARY = "library";
const browserFeats = new Map<string, Map<string, TableFeat>>();

export function registerTableFeatReader(reader: (campaignId: string) => ReadonlyMap<string, TableFeat>): void {
  tableFeatReader = reader;
}

// `campaignId`: the table the feats are for (null for the library).
// `replace`: the snapshot is the table's whole list, so anything it does not
// name is gone. A feat given as null is removed (one the builder found
// forgotten or deleted).
export function registerBrowserTableFeats(
  feats: Record<string, TableFeat | null> | null | undefined,
  campaignId: string | null = null,
  options: { replace?: boolean } = {},
): void {
  if (typeof window === "undefined") {
    return;
  }
  const scope = campaignId || LIBRARY;
  const held = options.replace ? new Map<string, TableFeat>() : (browserFeats.get(scope) ?? new Map<string, TableFeat>());
  for (const [name, feat] of Object.entries(feats ?? {})) {
    if (feat) {
      held.set(key(name), feat);
    } else {
      held.delete(key(name));
    }
  }
  browserFeats.set(scope, held);
}

// Everything the browser was told, gone (a sign-out: the next account's
// tables and library are its own).
export function forgetBrowserTableFeats(): void {
  browserFeats.clear();
}

const KNOWN_FEATS = new Set(FEATS.map((feat) => key(feat.name)));

export function engineFeatNames(): string[] {
  return FEATS.map((feat) => feat.name);
}

// The canonical name of one of ODM's feats ("sharpshooter" -> "Sharpshooter"),
// or null for a name the engines do not run.
export function engineFeatNamed(name: string): string | null {
  return featRow(featTwinOf(name))?.name ?? null;
}

export function tableFeat(name: string, campaignId?: string | null): TableFeat | null {
  const own = key(name);
  if (!own || KNOWN_FEATS.has(own) || FEAT_TWINS[own]) {
    return null;
  }
  const fromTable = campaignId && tableFeatReader ? tableFeatReader(campaignId).get(own) : undefined;
  return fromTable ?? browserFeats.get(campaignId || LIBRARY)?.get(own) ?? null;
}

// The feats on a sheet as the engines run them: a table's workshop feat as
// the published feat it runs as (Martial Adept's maneuver slots, read by
// name where the regrant prunes choices).
export function featsAsRun(feats: string[] | undefined, campaignId?: string | null): string[] | undefined {
  return feats?.map((feat) => tableFeat(feat, campaignId)?.runsAs ?? feat);
}

// The feat the engines know a name as: the published feat a table's
// workshop feat runs as, its twin's, or its own, lower case.
export function featTwinOf(name: string, campaignId?: string | null): string {
  const own = key(name);
  const runsAs = tableFeat(name, campaignId)?.runsAs;
  if (runsAs && key(runsAs) !== own) {
    return featTwinOf(runsAs);
  }
  return FEAT_TWINS[own] ?? own;
}

// A sheet holds a feat when it is in sheet.feats, or (for sheets written by
// the DM's tools) among its features by the same name, or holds its twin or
// a workshop feat of its table that runs as it.
export function holdsFeat(
  sheet: { feats?: string[]; features?: Array<{ name: string }>; campaignId?: string },
  name: string,
): boolean {
  const wanted = key(name);
  return (
    (sheet.feats ?? []).some((feat) => featTwinOf(feat, sheet.campaignId) === wanted) ||
    (sheet.features ?? []).some((feature) => featTwinOf(feature.name, sheet.campaignId) === wanted)
  );
}

// The text of one of ODM's own feats, for the grants read from it
// (src/lib/srd/feat-grants.ts) where the catalog is not at hand; null for
// a content pack's feat, whose text the pack serves.
export function authoredFeatDesc(name: string): string | null {
  return featRow(name)?.desc ?? null;
}

// ---- the half-feats ----

export type FeatIncrease = { from: Ability[]; amount: 1 };

// The ability increase a feat's text opens with, in every wording the
// packs use: ODM's "Increase your Charisma by 1, to a maximum of 20" (from:
// cha), "Strength or Dexterity" (a choice of two), "one ability score"
// (any); Tome of Heroes' "Increase your Wisdom score by 1, up to a maximum
// of 20"; Level Up's "Raise your Strength attribute by 1, up to the
// attribute cap of 20", "Your Strength or Dexterity score increases by 1",
// "An ability score of your choice increases by 1" and "Choose an
// attribute and raise it by 1". Null for text that raises nothing.
export function featAbilityIncreaseFrom(desc: string | null | undefined): FeatIncrease | null {
  const text = (desc ?? "").toLowerCase().replace(/[*_]/g, "").replace(/\s+/g, " ");
  const clause = /\bchoose an? (?:attribute|ability score) and (?:raise|increase) it by 1\b|\b(?:an|one|any) (?:ability score|attribute) of your choice increases by 1\b/.test(text)
    ? "one ability score"
    : (/\b(?:increase|raise) (?:your )?([a-z ,]*?)(?: score| attribute)? by 1\b/.exec(text)?.[1] ??
      /\b(?:your )?((?:[a-z]+(?: or [a-z]+)?)) (?:score|attribute) increases by 1\b/.exec(text)?.[1] ??
      null);
  if (!clause) {
    return null;
  }
  const from = Object.entries(ABILITY_WORDS)
    .filter(([word]) => new RegExp(`\\b${word}\\b`, "i").test(clause))
    .map(([, ability]) => ability);
  if (from.length) {
    return { from, amount: 1 };
  }
  return /\b(?:ability|attribute)\b/.test(clause) ? { from: [...ABILITIES], amount: 1 } : null;
}

// The ability increase a feat opens with: ODM's feats by name, a content
// pack's from the text handed in (the catalog's, or the builder's fetch).
// Null for a feat that raises nothing, or a pack feat with no text at hand.
export function featAbilityIncrease(name: string, desc?: string | null): FeatIncrease | null {
  return featAbilityIncreaseFrom(featRow(name)?.desc ?? desc ?? "");
}

// The scores after taking a feat. `chosen` names the ability where the feat
// offers more than one; a feat with one ability needs none. A score already
// at 20 stays there (the feat's own cap). Returns an error sentence when the
// choice is missing or not one the feat offers.
export function applyFeatIncrease(
  abilities: Record<Ability, number>,
  feat: string,
  chosen?: Ability | null,
  desc?: string | null,
): { abilities: Record<Ability, number>; raised: Ability | null } | { error: string } {
  const increase = featAbilityIncrease(feat, desc);
  if (!increase) {
    return { abilities, raised: null };
  }
  const ability = increase.from.length === 1 ? increase.from[0] : chosen ?? null;
  if (!ability || !increase.from.includes(ability)) {
    return {
      error: `${featRow(feat)?.name ?? feat} raises one of ${increase.from.map((entry) => entry.toUpperCase()).join(", ")} by 1; choose which.`,
    };
  }
  return {
    abilities: { ...abilities, [ability]: Math.min(20, abilities[ability] + increase.amount) },
    raised: ability,
  };
}

// Resilient: proficiency in saving throws of the ability it raised. A pack
// feat says so in its text (Level Up's Tenacious: "become proficient with
// saving throws using the selected attribute").
export function featSaveProficiency(feat: string, raised: Ability | null, desc?: string | null): Ability | null {
  if (featTwinOf(feat) === "resilient") {
    return raised;
  }
  return /\bsaving throws? (?:using|with|of) (?:the |that )?(?:selected|chosen) (?:attribute|ability|score)\b/i.test(desc ?? "") ? raised : null;
}

// ---- numbers read from sheet.feats ----

// Tough: the hit point maximum rises by twice the character level.
export function featHitPointBonus(sheet: { feats?: string[]; features?: Array<{ name: string }> }, level: number): number {
  return holdsFeat(sheet, "Tough") ? 2 * Math.max(1, Math.min(20, level)) : 0;
}

// Mobile: +10 feet of walking speed.
export function featSpeedBonus(sheet: { feats?: string[]; features?: Array<{ name: string }> }): number {
  return holdsFeat(sheet, "Mobile") ? 10 : 0;
}

// War Caster: advantage on the Constitution save to keep concentration.
export function hasWarCaster(sheet: { feats?: string[]; features?: Array<{ name: string }> }): boolean {
  return holdsFeat(sheet, "War Caster");
}

// Heavy Armor Master: while wearing heavy armor, bludgeoning, piercing and
// slashing damage from nonmagical attacks is reduced by 3.
export function heavyArmorMasterReduction(
  sheet: { feats?: string[]; features?: Array<{ name: string }> },
  input: { wearingHeavyArmor: boolean; damageType: string; magical: boolean },
): number {
  if (!holdsFeat(sheet, "Heavy Armor Master") || !input.wearingHeavyArmor || input.magical) {
    return 0;
  }
  return ["bludgeoning", "piercing", "slashing"].includes(input.damageType.trim().toLowerCase()) ? 3 : 0;
}
