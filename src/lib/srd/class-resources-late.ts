// Counters of the class resource table (src/lib/srd/class-resources.ts spreads
// them into SRD_RESOURCE_DEFS in place): Heroic Inspiration, which the DM
// awards and a roll spends, and the class features that keep a count of their
// own (Relentless Rage, Wholeness of Body, Eldritch Master, Signature Spells,
// Overchannel, Dark One's Own Luck, Hurl Through Hell). Kept apart so the
// table file does not grow past reading; the type is imported as a type only,
// so the two files do not load each other.

import type { ResourceDef } from "@/lib/srd/class-resources";
import { UNLIMITED_USES } from "@/lib/srd/resource-limits";

export const LATE_RESOURCE_DEFS: ResourceDef[] = [
  {
    // Heroic Inspiration as the SRD has it: the DM awards it (set_condition
    // "inspiration"), a roll spends it for advantage (useInspiration). No
    // feature grants it, so populateResources never makes one; it keeps the
    // counters' permissions (a player spends, the DM gives back).
    id: "inspiration",
    // Named only exactly, so "Bardic Inspiration" never grants it.
    match: ["heroic inspiration"],
    exact: true,
    displayName: "Inspiration",
    maxFor: () => 1,
    recharge: "long",
    noRefill: true,
    passive: true,
    effect: { kind: "narrative" },
    guidance:
      "Inspiration is spent on a roll, not with use_resource: pass useInspiration on request_roll for advantage on that check, save or attack.",
  },
  {
    // Barbarian 11: the save's DC climbs by 5 with each use and falls back to
    // 10 on a rest, so the counter counts uses since the last rest.
    id: "relentless_rage",
    classIds: ["barbarian"],
    grantedBy: ["barbarian"],
    match: ["relentless rage"],
    exact: true,
    displayName: "Relentless Rage",
    maxFor: () => UNLIMITED_USES,
    recharge: "short",
    passive: true,
    effect: { kind: "narrative" },
    guidance:
      "Not spent by choice: while raging, damage that drops them to 0 (and does not kill them outright) forces a CON save, DC 10 plus 5 for every use since their last rest, and a success leaves them at 1 hit point. The server rolls it.",
  },
  {
    id: "wholeness_of_body",
    classIds: ["monk"],
    grantedBy: ["monk"],
    match: ["wholeness of body"],
    exact: true,
    displayName: "Wholeness of Body",
    maxFor: () => 1,
    recharge: "long",
    action: "action",
    effect: { kind: "heal_self", dice: (level) => String(3 * Math.max(1, level)) },
    guidance: "An action: the monk regains hit points equal to three times their monk level.",
  },
  {
    // Warlock 20: once per long rest, a minute's entreaty to the patron
    // brings back every expended Pact Magic slot (src/lib/dm/feature-spends.ts).
    id: "eldritch_master",
    classIds: ["warlock"],
    grantedBy: ["warlock"],
    match: ["eldritch master"],
    exact: true,
    displayName: "Eldritch Master",
    maxFor: () => 1,
    recharge: "long",
    effect: { kind: "narrative" },
    guidance:
      "One minute spent entreating the patron: every expended Pact Magic slot comes back. The server refills them.",
  },
  {
    // Wizard 20: each of the two Signature Spells is cast once at 3rd level
    // with no slot, back on a short rest. The cast guard spends them
    // (src/lib/dm/caster-features.ts); the feature names the spells.
    id: "signature_spell_1",
    classIds: ["wizard"],
    grantedBy: ["wizard"],
    match: ["signature spells"],
    displayName: "Signature Spell (first)",
    maxFor: () => 1,
    recharge: "short",
    passive: true,
    effect: { kind: "narrative" },
    guidance: "The first spell named on Signature Spells, cast at 3rd level with no slot; the server spends it when the spell is cast.",
  },
  {
    id: "signature_spell_2",
    classIds: ["wizard"],
    grantedBy: ["wizard"],
    match: ["signature spells"],
    displayName: "Signature Spell (second)",
    maxFor: () => 1,
    recharge: "short",
    passive: true,
    effect: { kind: "narrative" },
    guidance: "The second spell named on Signature Spells, cast at 3rd level with no slot; the server spends it when the spell is cast.",
  },
  {
    // School of Evocation 14: the uses since the last long rest set what the
    // next one costs (src/lib/dm/caster-features.ts).
    id: "overchannel",
    classIds: ["wizard"],
    grantedBy: ["wizard"],
    match: ["overchannel"],
    exact: true,
    displayName: "Overchannel",
    maxFor: () => UNLIMITED_USES,
    recharge: "long",
    passive: true,
    effect: { kind: "narrative" },
    guidance: "Pass overchannel on cast_at_enemy or aoe_damage: the spell deals its maximum damage; after the first use each long rest the wizard takes 2d12 necrotic per spell level (1d12 more per level each further use), which the server rolls.",
  },
  {
    id: "dark_ones_own_luck",
    classIds: ["warlock"],
    match: ["dark one's own luck"],
    exact: true,
    displayName: "Dark One's Own Luck",
    maxFor: () => 1,
    recharge: "short",
    effect: {
      kind: "buff",
      condition: "dark one's own luck (d10)",
      rounds: 10,
      target: "self",
    },
    guidance:
      "The warlock adds a d10 to one ability check or saving throw. The server holds the die on them and adds it to their next check or save.",
  },
  {
    id: "hurl_through_hell",
    classIds: ["warlock"],
    match: ["hurl through hell"],
    exact: true,
    displayName: "Hurl Through Hell",
    maxFor: () => 1,
    recharge: "long",
    effect: { kind: "narrative" },
    guidance:
      "After a hit, the creature vanishes through the lower planes until the end of the warlock's next turn and, unless it is a fiend, takes 10d10 psychic damage when it returns. Resolve the damage with damage_enemy (type psychic); no save is allowed.",
  },
];
