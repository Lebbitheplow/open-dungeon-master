// Content-pack monster rows that disagree with the SRD 5.1 stat block they
// copy, corrected when the row is read. The pack itself (data/content/
// open5e.sqlite) is left as imported: a reimport would bring the error back,
// so the correction lives here, keyed by the row's document and slug, and
// only the fields named are replaced. `multiattack` rewrites the Multiattack
// action's text where it names an attack by a short form of its name ("its
// stinger" for Tail Stinger): the routine reads attacks by their whole name
// (src/lib/bestiary/attack-text.ts), so the line says the name the block
// gives the attack.
type Correction = Partial<{
  damage_immunities: string;
  damage_resistances: string;
  damage_vulnerabilities: string;
  condition_immunities: string;
  multiattack: string;
}>;

const CORRECTIONS: Record<string, Correction> = {
  // SRD 5.1 Skeleton: vulnerable to bludgeoning, immune to poison (the row
  // files poison under resistances).
  "wotc-srd/skeleton": { damage_immunities: "poison", damage_resistances: "" },
  // SRD 5.1 Zombie: immune to poison (the row leaves immunities empty).
  "wotc-srd/zombie": { damage_immunities: "poison" },
  "wotc-srd/purple-worm": { multiattack: "The worm makes two attacks: one with its bite and one with its tail stinger." },
  "tob/mamura": { multiattack: "The mamura makes three claw attacks and one whiptail stinger attack." },
  "tob/star-spawn-of-cthulhu": {
    multiattack: "The star spawn can use disintegrating gaze if it's available, and also make one crushing claws attack and one dimensional stomp attack.",
  },
  "tob2/forest-emperor": {
    multiattack:
      "The forest emperor makes two acidic claw attacks and one tail attack. If both claws hit the same target, the target must succeed on a DC 18 Constitution saving throw or its hp maximum is reduced by 7 (2d6) and the forest emperor regains hp equal to this amount. This reduction lasts until the target finishes a long rest. The target dies if this effect reduces its hp maximum to 0.",
  },
  "tob2/ophidiotaur": { multiattack: "The ophidiotaur makes two attacks: one with its bite and one with its poisoned glaive." },
  "tob-2023/crystallinedevil-tob1-2023": { multiattack: "The devil makes three Shard Claw attacks." },
};

export function correctedMonsterData(data: Record<string, unknown>): Record<string, unknown> {
  const document = String(data.document__slug ?? data.document_slug ?? "wotc-srd");
  const correction = CORRECTIONS[`${document}/${String(data.slug ?? "")}`];
  if (!correction) {
    return data;
  }
  const { multiattack, ...fields } = correction;
  if (!multiattack) {
    return { ...data, ...fields };
  }
  const actions = (data.actions as Array<Record<string, unknown>>).map((action) => (action.name === "Multiattack" ? { ...action, desc: multiattack } : action));
  return { ...data, ...fields, actions };
}
