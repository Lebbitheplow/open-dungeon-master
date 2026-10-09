import { MAX_ATTACKS, MAX_TRAITS, type MonsterDraft } from "@/lib/bestiary/monster-draft";
import { BLOCK_LIMITS } from "@/lib/bestiary/block-check";
import { abilityKey, type MonsterAbility } from "@/lib/dm/monster-abilities";
import type { EnemyAttack, EnemyStats } from "@/lib/bestiary/statblock";

// Taking one part of a published monster onto a hand-built one: a dragon's
// breath, a ghoul's paralysing claws, a mage's spellcasting, a troll's
// regeneration. The kit (kit.ts) builds a monster from the character
// catalogue; this is the same idea aimed at the bestiary itself, so a DM
// assembling a boss picks the engine-run part instead of retyping it and
// hoping the trait parser reads it the same way.
//
// A part is copied whole: an attack with its reach, range, riders and
// on-hit effect; an ability with its DC, dice and recharge plus the trait
// line the DM running the monster reads; the spellcasting block with its
// slots and list. What lands is ordinary draft fields, editable like
// anything typed. Pure: the borrow picker runs it in the browser.

export type BorrowPart =
  | { kind: "attack"; key: string; label: string; attack: EnemyAttack }
  | { kind: "ability"; key: string; label: string; ability: MonsterAbility; line: string | null }
  | { kind: "trait"; key: string; label: string; line: string }
  | { kind: "spellcasting"; key: string; label: string; casting: NonNullable<EnemyStats["spellcasting"]> }
  | { kind: "regeneration"; key: string; label: string; regeneration: NonNullable<EnemyStats["regeneration"]> };

// The trait line that belongs to an ability: the one whose name is the
// ability's, tags aside ("Fire Breath (Recharge 5-6): ...").
function lineFor(stats: EnemyStats, ability: MonsterAbility): string | null {
  const key = abilityKey(ability.name);
  return (
    stats.traits.find((line) => {
      const bare = line.replace(/^(legendary|lair|reaction|bonus)( action)?\s*:\s*/i, "");
      return abilityKey(bare.split(":")[0] ?? "") === key || abilityKey(bare.split(".")[0] ?? "") === key;
    }) ?? null
  );
}

function abilityLabel(ability: MonsterAbility): string {
  const bits = [
    ability.legendaryCost ? `legendary, ${ability.legendaryCost} action${ability.legendaryCost === 1 ? "" : "s"}` : "",
    ability.recharge ? `recharge ${ability.recharge}-6` : "",
    ability.perDay ? `${ability.perDay}/day` : "",
    ability.dc && ability.save ? `DC ${ability.dc} ${ability.save.toUpperCase()}` : "",
    ability.damage ? `${ability.damage} ${ability.damageType ?? ""}`.trim() : "",
    ability.condition ?? "",
  ].filter(Boolean);
  return bits.length ? `${ability.name} (${bits.join(", ")})` : ability.name;
}

export function attackLabel(attack: EnemyAttack): string {
  const reach = attack.range ? `range ${attack.range.normal}/${attack.range.long} ft` : attack.reach ? `reach ${attack.reach} ft` : "";
  const riders = (attack.riders ?? []).map((rider) => `+${rider.dice} ${rider.type}`).join(" ");
  const onHit = attack.onHit?.condition ? `, ${attack.onHit.condition}${attack.onHit.save ? ` (DC ${attack.onHit.dc} ${attack.onHit.save.toUpperCase()})` : ""}` : "";
  return `${attack.name}: +${attack.toHit}, ${attack.damage} ${attack.type}${riders ? ` ${riders}` : ""}${reach ? `, ${reach}` : ""}${onHit}`;
}

// Every part of a block that can travel on its own, in the order a book
// prints them.
export function borrowParts(stats: EnemyStats): BorrowPart[] {
  const parts: BorrowPart[] = [];
  const claimed = new Set<string>();
  for (const attack of stats.attacks) {
    parts.push({ kind: "attack", key: `attack:${attack.name}`, label: attackLabel(attack), attack });
  }
  for (const ability of stats.specials ?? []) {
    const line = lineFor(stats, ability);
    if (line) {
      claimed.add(line);
    }
    parts.push({ kind: "ability", key: `ability:${ability.name}`, label: abilityLabel(ability), ability, line });
  }
  if (stats.spellcasting) {
    const casting = stats.spellcasting;
    const slots = Object.entries(casting.slots).map(([level, count]) => `${count}x${level}`).join(" ");
    parts.push({
      kind: "spellcasting",
      key: "spellcasting",
      label: `Spellcasting${casting.dc ? ` (DC ${casting.dc})` : ""}: ${casting.spells.map((spell) => spell.name).join(", ")}${slots ? `; slots ${slots}` : ""}`,
      casting,
    });
  }
  if (stats.regeneration) {
    parts.push({
      kind: "regeneration",
      key: "regeneration",
      label: `Regeneration ${stats.regeneration.amount}${stats.regeneration.stoppedBy.length ? `, stopped by ${stats.regeneration.stoppedBy.join(", ")}` : ""}`,
      regeneration: stats.regeneration,
    });
  }
  for (const line of stats.traits) {
    if (!claimed.has(line) && !/^(spellcasting|innate spellcasting|regeneration)\b/i.test(line)) {
      parts.push({ kind: "trait", key: `trait:${line}`, label: line, line });
    }
  }
  return parts;
}

// Why a part cannot be added, or null. The draft's own caps decide.
export function borrowBlocked(draft: MonsterDraft, part: BorrowPart): string | null {
  const stats = draft.stats;
  if (part.kind === "attack" && stats.attacks.length >= MAX_ATTACKS) {
    return `The block holds ${MAX_ATTACKS} attacks.`;
  }
  if ((part.kind === "trait" || (part.kind === "ability" && part.line)) && stats.traits.length >= MAX_TRAITS) {
    return `The block is full at ${MAX_TRAITS} lines.`;
  }
  if (part.kind === "ability" && (stats.specials ?? []).length >= BLOCK_LIMITS.specials) {
    return `The block holds ${BLOCK_LIMITS.specials} abilities.`;
  }
  return null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The draft with the part on it. A part the draft already has under the
// same name is replaced, not doubled.
export function borrowInto(draft: MonsterDraft, part: BorrowPart): MonsterDraft {
  const stats = draft.stats;
  switch (part.kind) {
    case "attack": {
      const attacks = [...stats.attacks.filter((attack) => !sameName(attack.name, part.attack.name)), part.attack].slice(0, MAX_ATTACKS);
      return { ...draft, stats: { ...stats, attacks } };
    }
    case "ability": {
      const specials = [...(stats.specials ?? []).filter((entry) => !sameName(entry.name, part.ability.name)), part.ability].slice(
        0,
        BLOCK_LIMITS.specials,
      );
      const traits = part.line && !stats.traits.includes(part.line) ? [...stats.traits, part.line].slice(0, MAX_TRAITS) : stats.traits;
      return { ...draft, stats: { ...stats, specials, traits } };
    }
    case "trait":
      return stats.traits.includes(part.line)
        ? draft
        : { ...draft, stats: { ...stats, traits: [...stats.traits, part.line].slice(0, MAX_TRAITS) } };
    case "spellcasting":
      return {
        ...draft,
        stats: {
          ...stats,
          spellcasting: part.casting,
          spells: [...new Set([...(stats.spells ?? []), ...part.casting.spells.map((spell) => spell.name)])].slice(0, BLOCK_LIMITS.spells),
        },
      };
    case "regeneration":
      return { ...draft, stats: { ...stats, regeneration: part.regeneration } };
  }
}
