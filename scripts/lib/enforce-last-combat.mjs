// What the last-combat suites share: the average a dice expression rolls,
// the average a printed attack line gives, and SRD 5.1 Multiattack blocks
// written out with only what the routine parser reads (the Multiattack
// text and the attacks' names and kinds), so the suite reads the same with
// the content pack and without it.

// The mean of "2d10+6+2d6", as the rulebook computes a printed average.
export function averageOf(expression) {
  let total = 0;
  for (const term of String(expression).replace(/\s+/g, "").split(/(?=[+-])/)) {
    const sign = term.startsWith("-") ? -1 : 1;
    const body = term.replace(/^[+-]/, "");
    const dice = /^(\d+)d(\d+)$/i.exec(body);
    if (dice) {
      total += (sign * Number(dice[1]) * (Number(dice[2]) + 1)) / 2;
    } else if (/^\d+$/.test(body)) {
      total += sign * Number(body);
    }
  }
  return total;
}

// "Hit: 7 (1d8 + 3) piercing damage plus 4 (1d8) poison damage." -> 11: the
// first number with dice after "Hit:" and every "plus N (dice)". Null when
// the line prints no dice.
export function printedAverage(desc) {
  const at = desc.search(/hit:/i);
  if (at < 0) {
    return null;
  }
  const hit = desc.slice(at + 4).trim();
  const first = /^(\d+)\s*\([^)]*d[^)]*\)/.exec(hit);
  if (!first) {
    return null;
  }
  return [...hit.matchAll(/plus\s+(\d+)\s*\([^)]*d[^)]*\)/gi)].reduce((sum, match) => sum + Number(match[1]), Number(first[1]));
}

const melee = (name) => ({ name, desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.", attack_bonus: 5, damage_dice: "1d6", damage_bonus: 2 });
const ranged = (name) => ({ name, desc: "Ranged Weapon Attack: +5 to hit, range 150/600 ft., one target. Hit: 5 (1d8 + 2) piercing damage.", attack_bonus: 5, damage_dice: "1d8", damage_bonus: 2 });

// The SRD's Multiattack text, word for word, and the attacks each block has.
export const ROUTINE_ROWS = {
  blocks: {
    behir: ["The behir makes two attacks: one with its bite and one to constrict.", [melee("Bite"), melee("Constrict")]],
    centaur: ["The centaur makes two attacks: one with its pike and one with its hooves or two with its longbow.", [melee("Pike"), melee("Hooves"), ranged("Longbow")]],
    lamia: ["The lamia makes two attacks: one with its claws and one with its dagger or Intoxicating Touch.", [
      melee("Claws"), melee("Dagger"),
      { name: "Intoxicating Touch", desc: "Melee Spell Attack: +5 to hit, reach 5 ft., one creature. Hit: The target is magically cursed for 1 hour. Until the curse ends, the target has disadvantage on Wisdom saving throws and all ability checks." },
    ]],
    manticore: ["The manticore makes three attacks: one with its bite and two with its claws or three with its tail spikes.", [melee("Bite"), melee("Claw"), ranged("Tail Spike")]],
    medusa: ["The medusa makes either three melee attacks - one with its snake hair and two with its shortsword - or two ranged attacks with its longbow.", [melee("Snake Hair"), melee("Shortsword"), ranged("Longbow")]],
    merrow: ["The merrow makes two attacks: one with its bite and one with its claws or harpoon.", [melee("Bite"), melee("Claws"), melee("Harpoon")]],
    sahuagin: ["The sahuagin makes two melee attacks: one with its bite and one with its claws or spear.", [melee("Bite"), melee("Claws"), melee("Spear")]],
    werewolf: ["The werewolf makes two attacks: two with its spear (humanoid form) or one with its bite and one with its claws (hybrid form).", [melee("Bite (Wolf or Hybrid Form Only)"), melee("Claws (Hybrid Form Only)"), melee("Spear (Humanoid Form Only)")]],
    roper: ["The roper makes four attacks with its tendrils, uses Reel, and makes one attack with its bite.", [
      { name: "Bite", desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 22 (4d8 + 4) piercing damage.", attack_bonus: 7, damage_dice: "4d8", damage_bonus: 4 },
      { name: "Tendril", desc: "Melee Weapon Attack: +7 to hit, reach 50 ft., one creature. Hit: The target is grappled (escape DC 15). Until the grapple ends, the target is restrained and has disadvantage on Strength checks and Strength saving throws, and the roper can't use the same tendril on another target.", attack_bonus: 7 },
      { name: "Reel", desc: "The roper pulls each creature grappled by it up to 25 ft. straight toward it." },
    ]],
    drider: ["The drider makes three attacks, either with its longsword or its longbow. It can replace one of those attacks with a bite attack.", [melee("Bite"), melee("Longsword"), ranged("Longbow")]],
    oni: ["The oni makes two attacks, either with its claws or its glaive.", [melee("Claw (Oni Form Only)"), melee("Glaive")]],
    grick: ["The grick makes one attack with its tentacles. If that attack hits, the grick can make one beak attack against the same target.", [melee("Tentacles"), melee("Beak")]],
  },
  expected: {
    behir: [[{ attack: "Bite", count: 1 }, { attack: "Constrict", count: 1 }]],
    centaur: [[{ attack: "Pike", count: 1 }, { attack: "Hooves", count: 1 }], [{ attack: "Longbow", count: 2 }]],
    lamia: [[{ attack: "Claws", count: 1 }, { attack: "Dagger", count: 1 }]],
    manticore: [[{ attack: "Bite", count: 1 }, { attack: "Claw", count: 2 }], [{ attack: "Tail Spike", count: 3 }]],
    medusa: [[{ attack: "Snake Hair", count: 1 }, { attack: "Shortsword", count: 2 }], [{ attack: "Longbow", count: 2 }]],
    merrow: [[{ attack: "Bite", count: 1 }, { attack: "Claws", count: 1 }], [{ attack: "Bite", count: 1 }, { attack: "Harpoon", count: 1 }]],
    sahuagin: [[{ attack: "Bite", count: 1 }, { attack: "Claws", count: 1 }], [{ attack: "Bite", count: 1 }, { attack: "Spear", count: 1 }]],
    werewolf: [[{ attack: "Spear (Humanoid Form Only)", count: 2 }], [{ attack: "Bite (Wolf or Hybrid Form Only)", count: 1 }, { attack: "Claws (Hybrid Form Only)", count: 1 }]],
    roper: [[{ attack: "Tendril", count: 4 }, { attack: "Bite", count: 1 }]],
    drider: [[{ attack: "Longsword", count: 3 }], [{ attack: "Longbow", count: 3 }]],
    oni: [[{ attack: "Claw (Oni Form Only)", count: 2 }], [{ attack: "Glaive", count: 2 }]],
    grick: [[{ attack: "Tentacles", count: 1 }, { attack: "Beak", count: 1, ifHit: true }]],
  },
};

// The block as the pack stores it.
export function routineRow(slug) {
  const [multiattack, attacks] = ROUTINE_ROWS.blocks[slug];
  return {
    name: slug, size: "Large", type: "Monstrosity", armor_class: 14, hit_points: 60, cr: 3,
    actions: [{ name: "Multiattack", desc: multiattack }, ...attacks],
  };
}
