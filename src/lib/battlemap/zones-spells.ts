// The spells that leave an area on the battle map, and what that area does,
// as SRD 5.1 prints them. One row per spell; src/lib/battlemap/zones.ts lays
// the squares and answers what they cost, hide and block, and
// src/lib/dm/zone-triggers.ts resolves what happens to a creature entering
// the area or starting or ending its turn in it.
//
// The rows are read at use, never copied onto a stored zone, so a corrected
// row corrects the areas already on a board. Pure data: no DB.

export type ZoneShape =
  // A burst around a point: every square within `feet` of it (a cylinder
  // on the grid is the same thing).
  | "sphere"
  // A square of side `feet` centred on a point.
  | "cube"
  // A straight run of squares from the point toward another, `feet` long
  // and `widthFeet` wide (Gust of Wind: from the caster).
  | "line"
  // A wall: a line one square thick, up to `feet` long.
  | "wall"
  // A burst that moves with the caster (Spirit Guardians).
  | "aura";

export type ZoneSave = "str" | "dex" | "con" | "int" | "wis" | "cha";

// When a creature suffers the area. "enter" is the first time on a turn it
// moves into the area; "start" and "end" are its own turn's; "each5" is
// every 5 feet it travels in the area (Spike Growth).
export type ZoneMoment = "enter" | "start" | "end" | "each5";

export type ZoneTrigger = {
  on: ZoneMoment[];
  // "hostile": only creatures hostile to the caster (Spirit Guardians,
  // Guardian of Faith). Everyone otherwise.
  who?: "hostile";
  save?: ZoneSave;
  // Damage: dice, or a flat number written as a string ("20").
  dice?: string;
  type?: string;
  // Extra dice per slot level above the spell's own.
  perSlot?: string;
  // Half damage on a made save; no damage on one otherwise.
  half?: boolean;
  // Laid on a failed save (prone, restrained), tied to the spell and caster.
  condition?: string;
  // The damage lands only with the condition (Black Tentacles).
  damageOnFail?: boolean;
  // Stinking Cloud: a failed save spends the creature's action retching.
  losesAction?: boolean;
  // Sleet Storm: a creature concentrating there saves or loses it.
  concentrationSave?: boolean;
  // Gust of Wind: a failed save pushes this many feet away from the caster.
  pushFeet?: number;
  // Creatures immune to this damage type (poison) succeed on their own.
  immuneSucceeds?: string;
  // Strikes each creature once only (burning webs).
  once?: boolean;
};

export type ZoneTone = "fire" | "frost" | "gloom" | "fog" | "storm" | "nature" | "radiant" | "force" | "stone" | "poison" | "hush" | "blade";

export type ZoneRow = {
  shape: ZoneShape;
  feet: number;
  widthFeet?: number;
  // Fog Cloud: the radius grows this much per slot level above the spell's.
  perSlotFeet?: number;
  level: number;
  concentration: boolean;
  // How long it lasts, in rounds (1 minute = 10). Null: until the fight is
  // over (Plant Growth's overgrowth has no duration to run out).
  rounds: number | null;
  // Moving onto one of its squares costs this many feet per foot.
  difficult?: 2 | 4;
  // Spirit Guardians: a creature hostile to the caster moves at half speed
  // in the area (each square costs double, on top of difficult ground).
  halvesHostile?: boolean;
  // Gust of Wind: a step closer to the caster costs double.
  headwind?: boolean;
  obscured?: "light" | "heavy";
  // Magical darkness: no light shows in it and darkvision does not see
  // through it; blindsight, truesight and Devil's Sight do.
  darkness?: boolean;
  // Bright light over the area (Daylight), dim beyond is the board's own.
  light?: boolean;
  silence?: boolean;
  // A wall nothing walks through. `see` keeps the sight through it (Wall of
  // Force is invisible).
  blocks?: { see?: boolean };
  // A passage through rock (Passwall): its wall squares are open floor.
  opens?: boolean;
  // Laid on the caster's own square whatever point is named (Globe of
  // Invulnerability is centred on its caster and does not move).
  self?: boolean;
  // Globe of Invulnerability: a spell of this level or lower cast from
  // outside has no effect on anything inside (one level more per slot above
  // the spell's own).
  wardsSpellsUpTo?: number;
  // Sight stops at it though feet do not (Wall of Fire, Wall of Thorns).
  opaque?: boolean;
  // AC a creature behind it gains (Blade Barrier: three-quarters).
  cover?: 5;
  // Ranged weapon attacks through it miss (Wind Wall).
  deflectsMissiles?: boolean;
  // Wind Wall: a Small or smaller flying creature, or one in gaseous form,
  // cannot pass through it (src/lib/battlemap/zones-movers.ts), and a
  // drifting cloud stops at it.
  stopsSmallFlyers?: boolean;
  keepsGasesOut?: boolean;
  // A cloud of gas a Wind Wall holds back (src/lib/battlemap/zones-walls.ts).
  gas?: boolean;
  // Nothing crosses the area's edge, in or out (Forcecage), or no creature
  // but an undead or a construct does, nor reaches across it in melee
  // (Antilife Shell): src/lib/battlemap/zones-movers.ts.
  cage?: boolean;
  barsLiving?: boolean;
  // Antimagic Field: no spell is cast inside it, and none cast from outside
  // reaches a creature in it (src/lib/dm/zone-rules.ts).
  antimagic?: boolean;
  // Wall of Ice: 10-foot sections an attack can break (AC, hit points, the
  // damage type that deals double), each leaving the area named in `leaves`
  // where it stood (src/lib/dm/zone-walls.ts).
  sections?: { feet: number; ac: number; hp: number; vulnerable: string; leaves: string };
  // The area holds while its caster concentrates on this spell rather than
  // its own name (a Wall of Ice's frigid air ends with the wall).
  heldBy?: string;
  // Earthquake's saves when cast and at the end of each of the caster's
  // turns, and its fissures (src/lib/dm/zone-quake.ts).
  quake?: boolean;
  // Wall of Fire: the side away from the caster burns 10 feet out.
  hotSideFeet?: number;
  // Cloudkill, Incendiary Cloud: 10 feet away from the caster at the start
  // of each of the caster's turns.
  drifts?: number;
  // Guardian of Faith: gone once it has dealt this much damage.
  budget?: number;
  // Gust of Wind disperses these; Daylight dispels darkness of this level
  // or lower.
  disperses?: string[];
  dispelsDarknessUpTo?: number;
  trigger?: ZoneTrigger;
  tone: ZoneTone;
  // What it does, one line for GAME STATE and the board's label.
  summary: string;
};

const MINUTE = 10;

export const ZONE_ROWS: Record<string, ZoneRow> = {
  entangle: {
    shape: "cube", feet: 20, level: 1, concentration: true, rounds: MINUTE,
    difficult: 2, tone: "nature",
    summary: "difficult terrain",
  },
  grease: {
    shape: "cube", feet: 10, level: 1, concentration: false, rounds: MINUTE,
    difficult: 2, tone: "stone",
    trigger: { on: ["enter", "end"], save: "dex", condition: "prone" },
    summary: "difficult terrain; entering or ending a turn there: DEX save or prone",
  },
  "fog cloud": {
    shape: "sphere", feet: 20, perSlotFeet: 20, level: 1, concentration: true, rounds: 60 * MINUTE,
    obscured: "heavy", gas: true, tone: "fog",
    summary: "heavily obscured (blocks sight)",
  },
  darkness: {
    shape: "sphere", feet: 15, level: 2, concentration: true, rounds: 10 * MINUTE,
    darkness: true, obscured: "heavy", tone: "gloom",
    summary: "magical darkness: darkvision cannot see into it or through it",
  },
  silence: {
    shape: "sphere", feet: 20, level: 2, concentration: true, rounds: 10 * MINUTE,
    silence: true, tone: "hush",
    summary: "no sound: no spell with a verbal component is cast inside, creatures inside are deafened and immune to thunder damage",
  },
  "spike growth": {
    shape: "sphere", feet: 20, level: 2, concentration: true, rounds: 10 * MINUTE,
    difficult: 2, tone: "nature",
    trigger: { on: ["each5"], dice: "2d4", type: "piercing" },
    summary: "difficult terrain; 2d4 piercing for every 5 feet moved in it",
  },
  web: {
    shape: "cube", feet: 20, level: 2, concentration: true, rounds: 60 * MINUTE,
    difficult: 2, obscured: "light", tone: "stone",
    trigger: { on: ["enter", "start"], save: "dex", condition: "restrained" },
    summary: "difficult terrain, lightly obscured; entering or starting a turn there: DEX save or restrained",
  },
  moonbeam: {
    shape: "sphere", feet: 5, level: 2, concentration: true, rounds: MINUTE, tone: "radiant",
    trigger: { on: ["enter", "start"], save: "con", dice: "2d10", perSlot: "1d10", type: "radiant", half: true },
    summary: "entering or starting a turn there: CON save, 2d10 radiant (half on a success)",
  },
  "gust of wind": {
    shape: "line", feet: 60, widthFeet: 10, level: 2, concentration: true, rounds: MINUTE,
    headwind: true, disperses: ["fog cloud", "stinking cloud", "cloudkill", "incendiary cloud"], tone: "storm",
    trigger: { on: ["start"], save: "str", pushFeet: 15 },
    summary: "moving toward the caster costs double; starting a turn there: STR save or pushed 15 feet",
  },
  "sleet storm": {
    shape: "sphere", feet: 20, level: 3, concentration: true, rounds: MINUTE,
    difficult: 2, obscured: "heavy", tone: "frost",
    trigger: { on: ["enter", "start"], save: "dex", condition: "prone", concentrationSave: true },
    summary: "difficult terrain, heavily obscured; entering or starting a turn there: DEX save or prone, and a concentrating creature saves or loses it",
  },
  "stinking cloud": {
    shape: "sphere", feet: 20, level: 3, concentration: true, rounds: MINUTE,
    obscured: "heavy", gas: true, tone: "poison",
    trigger: { on: ["start"], save: "con", losesAction: true, immuneSucceeds: "poison" },
    summary: "heavily obscured; starting a turn there: CON save or spend the action retching",
  },
  "spirit guardians": {
    shape: "aura", feet: 15, level: 3, concentration: true, rounds: 10 * MINUTE,
    halvesHostile: true, tone: "radiant",
    trigger: { on: ["enter"], who: "hostile", save: "wis", dice: "3d8", perSlot: "1d8", type: "radiant", half: true },
    summary: "hostile creatures move at half speed; entering it: WIS save, 3d8 radiant (half on a success)",
  },
  daylight: {
    shape: "sphere", feet: 60, level: 3, concentration: false, rounds: 60 * MINUTE,
    light: true, dispelsDarknessUpTo: 3, tone: "radiant",
    summary: "bright light",
  },
  "plant growth": {
    shape: "sphere", feet: 100, level: 3, concentration: false, rounds: null,
    difficult: 4, tone: "nature",
    summary: "overgrowth: every foot moved costs 4",
  },
  "wind wall": {
    shape: "wall", feet: 50, level: 3, concentration: true, rounds: MINUTE,
    deflectsMissiles: true, stopsSmallFlyers: true, keepsGasesOut: true, tone: "storm",
    summary: "arrows, bolts and other ranged weapon attacks through it miss; a Small or smaller flyer or a creature in gaseous form cannot pass it; gases stop at it",
  },
  "black tentacles": {
    shape: "cube", feet: 20, level: 4, concentration: true, rounds: MINUTE,
    difficult: 2, tone: "gloom",
    trigger: { on: ["enter", "start"], save: "dex", dice: "3d6", type: "bludgeoning", condition: "restrained", damageOnFail: true },
    summary: "difficult terrain; entering or starting a turn there: DEX save or 3d6 bludgeoning and restrained",
  },
  // Ice Storm's hail: "the storm's area of effect becomes difficult terrain
  // until the end of your next turn" (the zone's clock runs by rounds: it
  // holds through the round after the casting).
  "ice storm": {
    shape: "sphere", feet: 20, level: 4, concentration: false, rounds: 2,
    difficult: 2, tone: "frost",
    summary: "hail-strewn ground: difficult terrain until the end of the caster's next turn",
  },
  "guardian of faith": {
    shape: "sphere", feet: 10, level: 4, concentration: false, rounds: 480 * MINUTE,
    budget: 60, tone: "radiant",
    trigger: { on: ["enter"], who: "hostile", save: "dex", dice: "20", type: "radiant", half: true },
    summary: "a hostile creature moving within 10 feet: DEX save, 20 radiant (half on a success); gone after 60 damage",
  },
  "wall of fire": {
    shape: "wall", feet: 60, level: 4, concentration: true, rounds: MINUTE,
    opaque: true, hotSideFeet: 10, tone: "fire",
    trigger: { on: ["enter", "end"], dice: "5d8", perSlot: "1d8", type: "fire" },
    summary: "opaque; entering it, or ending a turn in it or within 10 feet of its burning side: 5d8 fire",
  },
  cloudkill: {
    shape: "sphere", feet: 20, level: 5, concentration: true, rounds: 10 * MINUTE,
    obscured: "heavy", drifts: 10, gas: true, tone: "poison",
    trigger: { on: ["enter", "start"], save: "con", dice: "5d8", perSlot: "1d8", type: "poison", half: true },
    summary: "heavily obscured; entering or starting a turn there: CON save, 5d8 poison (half on a success); drifts 10 feet away from the caster each of the caster's turns",
  },
  "insect plague": {
    shape: "sphere", feet: 20, level: 5, concentration: true, rounds: 10 * MINUTE,
    difficult: 2, obscured: "light", tone: "nature",
    trigger: { on: ["enter", "end"], save: "con", dice: "4d10", perSlot: "1d10", type: "piercing", half: true },
    summary: "difficult terrain, lightly obscured; entering or ending a turn there: CON save, 4d10 piercing (half on a success)",
  },
  "wall of stone": {
    shape: "wall", feet: 100, level: 5, concentration: true, rounds: 10 * MINUTE,
    blocks: {}, tone: "stone",
    summary: "a stone wall: nothing walks or sees through it",
  },
  passwall: {
    shape: "wall", feet: 20, level: 5, concentration: false, rounds: 60 * MINUTE,
    opens: true, tone: "stone",
    summary: "a passage through the wall: its squares are open ground",
  },
  "globe of invulnerability": {
    shape: "sphere", feet: 10, level: 6, concentration: true, rounds: MINUTE,
    self: true, wardsSpellsUpTo: 5, tone: "force",
    summary: "a spell of 5th level or lower cast from outside has no effect on anything inside (higher from a higher slot)",
  },
  "wall of force": {
    shape: "wall", feet: 100, level: 5, concentration: true, rounds: 10 * MINUTE,
    blocks: { see: true }, tone: "force",
    summary: "an invisible wall: nothing passes through it, sight does",
  },
  "wall of ice": {
    shape: "wall", feet: 100, level: 6, concentration: true, rounds: 10 * MINUTE,
    blocks: {}, tone: "frost",
    sections: { feet: 10, ac: 12, hp: 30, vulnerable: "fire", leaves: "frigid air" },
    summary: "a wall of ice: nothing walks or sees through it; each 10-foot section (\"Wall of Ice section 1\" from its first end) has AC 12 and 30 hit points, double damage from fire, and breaks with damage_object, leaving frigid air",
  },
  // What a broken section of a Wall of Ice leaves in its space (SRD 5.1):
  // laid by the engine (src/lib/dm/zone-walls.ts), never cast; it lasts as
  // long as the wall's caster concentrates on the wall.
  "frigid air": {
    shape: "wall", feet: 10, level: 6, concentration: true, heldBy: "wall of ice", rounds: 10 * MINUTE, tone: "frost",
    trigger: { on: ["enter"], save: "con", dice: "5d6", perSlot: "1d6", type: "cold", half: true },
    summary: "a sheet of frigid air where the ice broke: moving through it for the first time on a turn, CON save or 5d6 cold (half on a success)",
  },
  earthquake: {
    shape: "sphere", feet: 100, level: 8, concentration: true, rounds: MINUTE,
    difficult: 2, quake: true, tone: "stone",
    summary: "difficult terrain; when cast and at the end of each of the caster's turns every creature on the ground makes a DEX save or falls prone, and a concentrating one a CON save or loses it; fissures open at the start of the caster's next turn",
  },
  // A cage of bars (20 feet a side); the solid box is the same to the walk.
  forcecage: {
    shape: "cube", feet: 20, level: 7, concentration: false, rounds: 60 * MINUTE,
    cage: true, tone: "force",
    summary: "an invisible cage of force: no creature inside walks out and none outside walks in; sight passes the bars",
  },
  "antilife shell": {
    shape: "aura", feet: 10, level: 5, concentration: true, rounds: 60 * MINUTE,
    barsLiving: true, tone: "radiant",
    summary: "a barrier around the caster: a creature other than an undead or a construct cannot pass through it or reach through it with a melee attack",
  },
  "antimagic field": {
    shape: "aura", feet: 10, level: 8, concentration: true, rounds: 60 * MINUTE,
    antimagic: true, tone: "force",
    summary: "no spell can be cast inside it, and a spell cast from outside has no effect on a creature inside; magic items and other spells' effects inside are suppressed (the DM's to narrate)",
  },
  "wall of thorns": {
    shape: "wall", feet: 60, level: 6, concentration: true, rounds: 10 * MINUTE,
    difficult: 4, opaque: true, tone: "nature",
    trigger: { on: ["enter", "end"], save: "dex", dice: "7d8", perSlot: "1d8", type: "slashing", half: true },
    summary: "blocks sight; every foot moved through it costs 4; entering it or ending a turn in it: DEX save, 7d8 slashing (half on a success)",
  },
  "blade barrier": {
    shape: "wall", feet: 100, level: 6, concentration: true, rounds: 10 * MINUTE,
    difficult: 2, cover: 5, tone: "blade",
    trigger: { on: ["enter", "start"], save: "dex", dice: "6d10", type: "slashing", half: true },
    summary: "three-quarters cover behind it, difficult terrain; entering or starting a turn there: DEX save, 6d10 slashing (half on a success)",
  },
  // Web's cubes a fire has caught: they burn away in a round, and a creature
  // starting its turn in the fire takes 2d4 fire (SRD 5.1, Web). Laid by the
  // engine when fire damage lands on a creature in the web, never cast.
  "burning web": {
    shape: "cube", feet: 5, level: 2, concentration: false, rounds: 2, tone: "fire",
    trigger: { on: ["start"], dice: "2d4", type: "fire", once: true },
    summary: "burning webs: a creature starting its turn here takes 2d4 fire",
  },
  "incendiary cloud": {
    shape: "sphere", feet: 20, level: 8, concentration: true, rounds: MINUTE,
    obscured: "heavy", drifts: 10, gas: true, tone: "fire",
    trigger: { on: ["enter", "end"], save: "dex", dice: "10d8", type: "fire", half: true },
    summary: "heavily obscured; entering or ending a turn there: DEX save, 10d8 fire (half on a success); drifts 10 feet away from the caster each of the caster's turns",
  },
};

// Names a spell is kept under by its authors ("Evard's Black Tentacles").
const ALIASES: Record<string, string> = {
  "evard's black tentacles": "black tentacles",
};

// A spell by its name, or a laid area by the spell it runs as: a table's
// workshop copy under a name of its own ("Silkbind") lays and reads the row
// of the published spell it copies (`runsAs`, "Web"), while its own name is
// what the board shows and what concentration holds.
export type ZoneNamed = string | { spell: string; runsAs?: string };

export function zoneKey(spell: ZoneNamed): string {
  const name = typeof spell === "string" ? spell : spell.runsAs || spell.spell;
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES[key] ?? key;
}

// The spell's own name as a key, never what it runs as: what a caster's
// concentration and a recast compare against.
export function zoneOwnKey(zone: { spell: string }): string {
  return zoneKey(zone.spell);
}

// Spells that light their caster's token rather than lay an area (SRD 5.1:
// bright light 20 feet, dim 20 more; the board's carried light, whose dim
// radius is double the bright). Minutes 0: it does not burn down.
export const LIGHT_SPELLS: Record<string, { radiusTiles: number; minutes: number }> = {
  light: { radiusTiles: 4, minutes: 60 },
  "continual flame": { radiusTiles: 4, minutes: 0 },
};

export function zoneRowFor(spell: ZoneNamed): ZoneRow | null {
  return ZONE_ROWS[zoneKey(spell)] ?? null;
}
