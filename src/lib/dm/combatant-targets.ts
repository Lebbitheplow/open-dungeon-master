// Every tool parameter that names the creature an act in a fight is aimed at
// (issue 503, Phase 6), and how it reads one. A target is any combatant: an
// enemy, or a character fighting on the other side (a companion turned on
// the party), so each of these resolves it through the one resolver,
// src/lib/dm/combatant.ts resolveCombatant (or sheet-foe.ts
// resolveTargetFoe, which hands the foe paths a sheet as a foe view).
//
// scripts/test-combatant-targets.mjs holds the tools to it: every parameter
// a tool offered in a fight names a target by (target..., second...Id,
// against...Id, and the few below) is listed here, and every one listed as
// "combatant" is read through the resolver in the handler file named: the
// file reads the parameter, calls the resolver, and never resolveEnemyRef. A
// new targeting parameter cannot ship reading enemies alone.
//
// No "@/" imports, so the guard test can load it directly.

export type TargetRule =
  // Any combatant, through resolveCombatant or resolveTargetFoe, in `file`.
  // `pending` says why one is not read that way yet; the guard test fails
  // the moment it is, so the note cannot outlive the work.
  | { kind: "combatant"; file: string; pending?: string }
  // The tool names its target by two parameters, one per kind, and both are
  // read (apply_damage's characterId and enemyId): a sheet on either side is
  // reached by the character one.
  | { kind: "both"; why: string }
  // Who the act is for, on the actor's own side (Help's ally, Protection's
  // covered ally): an ally is a character of the party's side by nature.
  | { kind: "ally"; why: string };

export const TARGET_PARAMS: Readonly<Record<string, TargetRule>> = {
  "pc_attack.targetEnemyId": { kind: "combatant", file: "src/lib/dm/pc-attack-gate.ts" },
  "enemy_attack.targetCharacterId": { kind: "combatant", file: "src/lib/dm/enemy-attack.ts" },
  "cast_at_enemy.targetEnemyId": { kind: "combatant", file: "src/lib/dm/cast-at-enemy.ts" },
  "cast_at_enemy.secondTargetEnemyId": { kind: "combatant", file: "src/lib/dm/authored-reaper.ts" },
  "cast_buff.targetEnemyId": { kind: "combatant", file: "src/lib/dm/cast-buff.ts" },
  "take_action.targetEnemyId": { kind: "combatant", file: "src/lib/dm/combat-actions.ts" },
  "use_reaction.targetEnemyId": { kind: "combatant", file: "src/lib/dm/reaction-tools.ts" },
  "use_resource.targetEnemyId": { kind: "combatant", file: "src/lib/dm/srd-feature-spends.ts" },
  "pet_attack.targetEnemyId": { kind: "combatant", file: "src/lib/dm/pet-tools.ts" },
  "request_roll.targetEnemyId": { kind: "combatant", file: "src/lib/dm/enemy-blow.ts" },
  "request_roll.againstEnemyId": { kind: "combatant", file: "src/lib/dm/roll-gates.ts" },
  "check_notice.againstEnemyId": { kind: "combatant", file: "src/lib/dm/roll-gates.ts" },
  "declare_intent.target": { kind: "combatant", file: "src/lib/dm/intent-tools.ts" },
  "cast_at_player.characterId": { kind: "both", why: "the target is a character; an enemy target is cast_at_enemy, and a character on either side is reached here" },
  "aoe_damage.targets": { kind: "both", why: "names of enemies and characters mixed, each read by its kind; characterIds and enemyIds beside it" },
  "apply_damage.targets": { kind: "both", why: "each entry an enemyId or a characterId" },
  "apply_damage.enemyId": { kind: "both", why: "beside characterId: a character on either side is reached by characterId" },
  "apply_damage.targets[].enemyId": { kind: "both", why: "beside targets[].characterId" },
  "enemy_attack.targetMount": { kind: "both", why: "names no creature itself: the mount of the character targetCharacterId resolves, on whichever side" },
  "take_action.targetCharacterId": { kind: "ally", why: "Help's ally" },
  "use_reaction.targetCharacterId": { kind: "ally", why: "the ally a reaction protects (Protection, Interception)" },
  "use_resource.targetCharacterId": { kind: "ally", why: "the ally a feature touches (Lay on Hands, Bardic Inspiration)" },
  "use_item.targetCharacterId": { kind: "ally", why: "the one a potion is fed to" },
  "cast_buff.targetCharacterIds": { kind: "ally", why: "the ones a buff lands on" },
};

// The parameter names that name a target, whatever the tool: the guard test
// requires each one it finds in a tool offered in a fight to be listed above.
// "against" alone is what a save resists, not a creature: only an id is.
export function namesATarget(param: string): boolean {
  const leaf = param.split(".").pop() ?? param;
  return /^target\w*$/i.test(leaf) || /^(second|against)\w*Ids?$/.test(leaf);
}
