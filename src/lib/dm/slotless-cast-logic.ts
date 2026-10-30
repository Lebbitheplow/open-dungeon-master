// A spell the story cast with no tool behind it (issue 570). The guard
// used to ask the model to write it out of the story (engine-boundary.ts
// ruleClaims "spell"), so a spell the player had asked for quietly
// vanished. Now one its caster's player asked for gets cast: the turn sends
// the model back to the spell's tool once (unpaidCastPrompt), and a cast
// still unpaid when the turn ends is cast by the engine itself when the
// player's own words fix the whole call (slotlessCastCall), the narration
// then told the real result. One the player never asked for is still
// written out: the model never acts for a player.
//
// Pure: the claims, the player's lines and the spell's mechanics in, the
// call and the prompt out.
import { containsPhrase, textKey } from "@/lib/language/text-logic";
import type { SpellMech } from "@/lib/srd/spell-mech-types";
import type { DirectCall, MessageIntent } from "@/lib/dm/intent-logic";

// A line the caster's player posted this turn, with the card it came on.
export type PlayerLine = { content: string; intent?: MessageIntent | null };

// A creature the player's words may name: a foe, an ally, or the caster.
export type CastCreature = { id: string; name: string; kind: "enemy" | "ally" | "self" };

// Whether the caster's player asked for the spell this turn: a card with
// it, or their own words naming it.
export function castDeclared(spell: string, lines: readonly PlayerLine[]): boolean {
  return lines.some((line) => (line.intent?.spell ? textKey(line.intent.spell) === textKey(spell) : false) || containsPhrase(line.content, spell));
}

// Whether a card the player played this turn carries the spell: the card
// is then the turn's to settle (it goes back if nothing carried it out).
export function castCarded(spell: string, lines: readonly PlayerLine[]): boolean {
  return lines.some((line) => Boolean(line.intent?.spell) && textKey(line.intent?.spell ?? "") === textKey(spell));
}

// The one creature the player's words name, when they name exactly one.
export function namedCreature(lines: readonly PlayerLine[], creatures: readonly CastCreature[]): CastCreature | null {
  const named = creatures.filter((creature) => lines.some((line) => containsPhrase(line.content, creature.name)));
  return named.length === 1 ? named[0] : null;
}

// The tool a spell is cast with, in the words the model reads.
export function castToolHint(mech: SpellMech | null, area: boolean): string {
  switch (mech?.resolution) {
    case "attack":
      return "pc_attack with spell";
    case "save":
    case "auto":
      return area ? "aoe_damage with spell and casterCharacterId" : "cast_at_enemy";
    case "heal":
      return "heal with casterId";
    case "buff":
      return "cast_buff";
    default:
      return "use_spell_slot";
  }
}

// The call that casts it, when the player's words fix every choice: a
// spell with nothing to aim (a utility spell, a summon, a buff on oneself)
// spends its slot; one aimed at a creature needs the one creature the words
// name. An area is the model's to lay. Null leaves the cast to the guard's
// rewrite, as before.
export function slotlessCastCall(mech: SpellMech | null, casterId: string, spell: string, target: CastCreature | null, area: boolean): DirectCall | null {
  const resolution = mech?.resolution ?? "utility";
  if (area && (resolution === "save" || resolution === "auto")) {
    return null;
  }
  switch (resolution) {
    case "attack":
      return target?.kind === "enemy" ? { name: "pc_attack", args: { characterId: casterId, targetEnemyId: target.id, spell } } : null;
    case "save":
    case "auto":
      return target?.kind === "enemy" ? { name: "cast_at_enemy", args: { characterId: casterId, targetEnemyId: target.id, spell } } : null;
    case "heal":
      return target && target.kind !== "enemy" ? { name: "heal", args: { characterId: target.id, casterId, spell } } : null;
    case "buff":
      if (mech?.buff?.target === "self") {
        return { name: "cast_buff", args: { characterId: casterId, spell } };
      }
      if (!target) {
        return null;
      }
      return target.kind === "enemy"
        ? { name: "cast_buff", args: { characterId: casterId, spell, targetEnemyId: target.id } }
        : { name: "cast_buff", args: { characterId: casterId, spell, targetCharacterIds: [target.id] } };
    default:
      return { name: "use_spell_slot", args: { characterId: casterId, spell } };
  }
}

// Whether a cast rolled something the narration has to follow now: an
// attack, a save, healing.
export function castRolled(toolName: string): boolean {
  return toolName === "pc_attack" || toolName === "cast_at_enemy" || toolName === "heal";
}

// The one corrective call for a cast the reply narrated with nothing behind
// it, which its caster's player asked for.
export function unpaidCastPrompt(cast: { caster: string; casterId: string; spell: string; quote: string }, tool: string): string {
  return `[System] Your narration has ${cast.caster} casting ${cast.spell} ("${cast.quote}"), but no tool cast it this turn, so it has not happened: no slot was spent and nothing was rolled. ${cast.caster}'s player asked for it: cast it now with ${tool} for characterId=${cast.casterId}, then narrate from the result. If the rules forbid it, the tool refuses and that refusal is what you narrate.`;
}
