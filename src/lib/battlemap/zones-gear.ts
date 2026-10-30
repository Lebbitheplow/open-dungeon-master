// The SRD 5.1 Adventuring Gear spread on the ground as an area: a bag of
// caltrops and a bag of ball bearings. They run as the spell areas do
// (src/lib/battlemap/zones-spells.ts zoneRowFor reads these after the
// spells), laid by use_item (src/lib/dm/gear-zones.ts) and resolved by the
// zone triggers when a creature enters; but nothing in them is magic, and
// their save DCs are the book's own. Pure data.

import type { ZoneRow } from "@/lib/battlemap/zones-spells";

// Caltrops: "Taking this damage reduces the creature's walking speed by 10
// feet until the creature regains at least 1 hit point."
export const CALTROPS_WOUND = "caltrops wound";

export const GEAR_ZONE_ROWS: Record<string, ZoneRow> = {
  // "As an action, you can spread a bag of caltrops to cover a square area
  // that is 5 feet on a side. Any creature that enters the area must succeed
  // on a DC 15 Dexterity saving throw or stop moving this turn and take 1
  // piercing damage." (issue #570, EQP-13)
  caltrops: {
    shape: "cube", feet: 5, level: 0, concentration: false, rounds: null, mundane: true, tone: "blade",
    trigger: { on: ["enter"], save: "dex", dice: "1", type: "piercing", damageOnFail: true, condition: CALTROPS_WOUND, stopsOnFail: true },
    summary: "caltrops: entering is a DC 15 DEX save or stop moving, 1 piercing and 10 feet less walking speed until healed",
  },
  // "As an action, you can spill these tiny metal balls from their pouch to
  // cover a level, square area that is 10 feet on a side. A creature moving
  // across the covered area must succeed on a DC 10 Dexterity saving throw
  // or fall prone."
  "ball bearings": {
    shape: "cube", feet: 10, level: 0, concentration: false, rounds: null, mundane: true, tone: "stone",
    trigger: { on: ["enter"], save: "dex", condition: "prone" },
    summary: "ball bearings: entering is a DC 10 DEX save or fall prone",
  },
};

// The bag each area is spread from, by its catalog row
// (src/lib/srd/adventuring-gear.ts), and the save DC the book gives it.
export const GEAR_ZONES: Array<{ gear: string; zone: string; dc: number }> = [
  { gear: "Caltrops (bag of 20)", zone: "Caltrops", dc: 15 },
  { gear: "Ball Bearings (bag of 1000)", zone: "Ball Bearings", dc: 10 },
];
