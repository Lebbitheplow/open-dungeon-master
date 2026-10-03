import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { planHazardFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { publishPersisted } from "@/lib/events";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { openFall } from "@/lib/dm/last-hit";
import { SUFFOCATING } from "@/lib/dm/vitals-logic";
import { handleCastAtPlayer } from "@/lib/dm/cast-tools";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { acBreakdownFor, computeSheetDerived } from "@/lib/srd";
import { hourlyConSaves } from "@/lib/dm/endurance";
import {
  breathHoldMinutes,
  extremeColdSave,
  extremeHeatSave,
  fallingDamageDice,
  suffocationRounds,
  trapProfile,
  type TrapSeverity,
} from "@/lib/srd/hazards";
import { pcResistances } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard } from "@/lib/dm/roll-card";
import { rollOn } from "@/lib/roll-labels";

// Traps and environmental hazards used to be pure narration routed through the
// generic damage_enemy call, so a "dart trap" or a "40-foot fall" dealt
// whatever the model guessed. apply_hazard makes the server own the numbers:
// falling scales at the PHB 1d6-per-10-feet, a trap's save DC and damage come
// from the DMG severity-by-level table against each victim's own tier, and the
// save itself runs through the same cast_at_player engine every monster save
// uses. Detection stays with check_notice (a trap is spotted by passive
// Perception before it is sprung); this tool is the springing.
//
// This module imports the sheet layer, the cast engine, and the damage
// engine; it must never be imported by them.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const HAZARD_TOOL_NAMES = ["apply_hazard"] as const;

const SEVERITY_ENUM = ["setback", "dangerous", "deadly"] as const;

export const hazardTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "apply_hazard",
      description:
        "Resolve a trap, a fall, or an environmental hazard against one or more characters with real 5e numbers. The server computes the damage and (for traps) the save DC from the book and applies the save and damage itself, so you never invent them. Use this instead of damage_enemy for any harm from the environment. Call it BEFORE narrating the result and narrate exactly what it reports. Types: 'falling' (pass feet; 1d6 per 10 ft, no save), 'trap' (pass severity; a Dexterity save and damage scaled to each victim's level), 'generic' (pass your own damage dice, saveAbility, and dc for a bespoke hazard like a gout of flame), 'suffocation'/'drowning' (a character out of air; pass roundsWithoutAir and the server derives from their Constitution how long they last before dropping to 0 HP), or 'extreme_cold'/'extreme_heat' (pass hours: one CON save per hour of exposure, a failure a level of exhaustion, applied automatically; cold weather gear or the matching resistance shrugs it off).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [
              "falling",
              "trap",
              "generic",
              "suffocation",
              "drowning",
              "extreme_cold",
              "extreme_heat",
            ],
            description: "Which hazard math to use.",
          },
          hours: {
            type: "integer",
            minimum: 1,
            maximum: 48,
            description:
              "extreme_cold/extreme_heat only: hours of exposure. The server rolls one Constitution save for each hour (cold DC 10; heat DC 5 rising by 1 an hour, at disadvantage in medium or heavy armor) and applies a level of exhaustion for each failure.",
          },
          roundsWithoutAir: {
            type: "integer",
            description:
              "suffocation/drowning only: how many rounds the character has already gone without air. 0 means they have just run out. The server compares this to how long their Constitution lets them last.",
          },
          characterIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "Exact characterIds caught by the hazard.",
          },
          feet: {
            type: "integer",
            description: "falling only: how far the character falls, in feet.",
          },
          severity: {
            type: "string",
            enum: [...SEVERITY_ENUM],
            description:
              "trap only: how dangerous the trap is. setback is a nuisance, dangerous can drop a careless character, deadly can kill.",
          },
          saveAbility: {
            type: "string",
            enum: ["str", "dex", "con", "int", "wis", "cha"],
            description: "trap/generic: the save the hazard forces. Defaults to dex.",
          },
          dc: { type: "integer", description: "generic only: the save DC." },
          damage: {
            type: "string",
            description: "generic only: the damage dice, e.g. 3d6.",
          },
          damageType: {
            type: "string",
            description: "Damage type (bludgeoning, piercing, fire, poison, ...). Resistances apply.",
          },
          halfOnSave: {
            type: "boolean",
            description: "Whether a successful save halves the damage. Defaults to true for traps.",
          },
          condition: {
            type: "string",
            description:
              "Optional condition a failed save also inflicts (e.g. poisoned, restrained).",
          },
          reason: { type: "string", description: "Short note on the hazard." },
        },
        required: ["type", "characterIds"],
      },
    },
  },
];

const hazardSchema = z.object({
  type: z.enum([
    "falling",
    "trap",
    "generic",
    "suffocation",
    "drowning",
    "extreme_cold",
    "extreme_heat",
  ]),
  characterIds: z.array(z.string()).min(1),
  feet: z.coerce.number().int().min(0).max(1000).optional(),
  roundsWithoutAir: z.coerce.number().int().min(0).max(100).optional(),
  // extreme_cold / extreme_heat: hours of exposure, one save for each.
  hours: z.coerce.number().int().min(1).max(48).optional(),
  severity: z.enum(["setback", "dangerous", "deadly"]).optional(),
  saveAbility: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
  dc: z.coerce.number().int().min(1).max(30).optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  halfOnSave: z.coerce.boolean().optional(),
  condition: z.string().max(40).optional(),
  reason: z.string().optional(),
});

export function handleApplyHazard(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: z.infer<typeof hazardSchema>;
  try {
    args = hazardSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: apply_hazard needs a type and characterIds." };
  }

  // Resolve the victims once; bad ids are reported, not silently dropped.
  const targets: CharacterSheet[] = [];
  const unknown: string[] = [];
  for (const id of args.characterIds) {
    const stale = resolveSheetRef(id, sheets, sheetsById);
    const sheet = stale ? getSheetById(stale.id) ?? stale : null;
    if (sheet && !targets.some((entry) => entry.id === sheet.id)) {
      targets.push(sheet);
    } else if (!sheet) {
      unknown.push(id);
    }
  }
  if (!targets.length) {
    return { error: `No valid characterIds${unknown.length ? `: ${unknown.join(", ")}` : ""}.` };
  }

  const source = (args.reason ?? "").trim() || defaultSource(args);
  const damageType =
    args.damageType?.trim() || (args.type === "falling" ? "bludgeoning" : "piercing");

  // Falling has no save: flat bludgeoning applied straight to each victim.
  if (args.type === "falling") {
    const dice = fallingDamageDice(args.feet ?? 0);
    if (dice === "0") {
      return { ok: true, type: "falling", feet: args.feet ?? 0, note: "Too short a fall to hurt." };
    }
    const perTarget = targets.map((sheet) => {
      // Feather Fall: a slow descent and no falling damage, and so no prone.
      if (sheet.conditions.some((entry) => entry.trim().toLowerCase() === "feather fall")) {
        return { name: sheet.name, damage: 0, note: `${sheet.name} drifts down under Feather Fall and lands unhurt.` };
      }
      // A fall: nobody made it, as an enemy's fall (src/lib/dm/enemy-fall.ts).
      const rolled = rollCard(campaign, turn, sheet.id, "damage", rollOn(`${args.feet ?? 0} ft fall (${dice} bludgeoning)`, [sheet.name]), dice, null);
      // Kept so Slow Fall and Feather Fall can answer it (src/lib/dm/last-hit.ts).
      const fall = openFall(campaign.id, sheet.id);
      // The server rolled these dice, so they land as rolled (20d6 can pass
      // the 200 a typed amount is held to), and a fall that hurts leaves the
      // creature prone.
      const applied = applyPcDamage(campaign, turn.id, sheet, {
        amount: rolled.total,
        type: damageType,
        knocksProne: true,
        reason: source,
      });
      fall.close(rolled.total);
      const pos = tokenPosition(campaign.id, sheet.id);
      if (pos) {
        publishFx(
          campaign.id,
          planHazardFx({
            to: pos.at,
            toTokenId: pos.tokenId,
            hazard: "falling",
            damageType,
            amount: rolled.total,
          }),
        );
      }
      return { name: sheet.name, damage: rolled.total, ...applied };
    });
    return {
      ok: true,
      type: "falling",
      feet: args.feet ?? 0,
      dice,
      results: perTarget,
      note: `${dice} bludgeoning to each; the server applied it.`,
    };
  }

  // suffocation / drowning: no save and no damage roll. A creature can hold
  // its breath for 1 + CON mod minutes, then survives CON-mod rounds before it
  // drops to 0 HP and is dying (PHB). The server owns that math from each
  // victim's real Constitution and applies the drop itself, so how long
  // someone lasts and when they go down is never the model's to fudge.
  if (args.type === "suffocation" || args.type === "drowning") {
    const out = args.roundsWithoutAir ?? 0;
    const perTarget = targets.map((sheet) => {
      const conMod = computeSheetDerived(sheet).abilityMods.con;
      const survival = suffocationRounds(conMod);
      if (out <= survival) {
        return {
          name: sheet.name,
          holdBreathMinutes: breathHoldMinutes(conMod),
          survivalRounds: survival,
          roundsWithoutAir: out,
          roundsLeft: survival - out,
          dropped: false,
        };
      }
      // Past the limit: they drop straight to 0 HP and begin dying. Damage
      // equal to their whole HP pool (temp and beast form included) floors
      // them at 0 and hands them to the server's death-save machinery,
      // however large the pool is.
      const pool = sheet.currentHp + (sheet.tempHp ?? 0) + (sheet.wildShape?.beastHp ?? 0);
      const applied =
        pool > 0
          ? applyPcDamage(campaign, turn.id, sheet, {
              amount: pool,
              reason: `${source} (out of air)`,
            })
          : { ok: true };
      // Still without air: nothing heals or stabilizes them until the
      // condition is cleared (src/lib/dm/mutations.ts heal, stabilize.ts).
      const down = getSheetById(sheet.id);
      if (down && !down.deathSaves?.dead && !down.conditions.includes(SUFFOCATING)) {
        const updated = patchSheet(down.id, { conditions: [...down.conditions, SUFFOCATING] });
        if (updated) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
        }
      }
      return {
        name: sheet.name,
        survivalRounds: survival,
        roundsWithoutAir: out,
        dropped: true,
        ...applied,
      };
    });
    return {
      ok: true,
      type: args.type,
      results: perTarget,
      note: "Breath math resolved from Constitution; anyone past their limit is at 0 HP, dying and suffocating. They cannot be healed or stabilized until they can breathe: once they reach air, call clear_condition with suffocating. Narrate the struggle for air.",
    };
  }

  // Extreme cold / heat (DMG): one CON save per hour of exposure; a failure
  // is a level of exhaustion, which the exhaustion track enforces from
  // there. Cold resistance or immunity shrugs it off entirely.
  if (args.type === "extreme_cold" || args.type === "extreme_heat") {
    const cold = args.type === "extreme_cold";
    const hours = Array.from({ length: args.hours ?? 1 }, (_, index) => ({
      hour: index + 1,
      dc: args.dc ?? (cold ? extremeColdSave() : extremeHeatSave(index + 1)).dc,
    }));
    const perTarget = targets.map((sheet) => {
      const shrug = exposureShrug(sheet, cold);
      if (shrug) {
        return { name: sheet.name, immune: shrug };
      }
      const saves = hourlyConSaves({
        campaign,
        turn,
        sheet,
        hours,
        disadvantage: !cold && heatHampers(sheet),
        detail: (hour) => `${sheet.name}: CON save vs ${cold ? "the cold" : "the heat"}, hour ${hour}`,
        reason: source,
        sheets,
        sheetsById,
      });
      return { name: sheet.name, saves };
    });
    return {
      ok: true,
      type: args.type,
      hours: hours.length,
      results: perTarget,
      note: `One Constitution save for each of ${hours.length} hour${hours.length === 1 ? "" : "s"} of exposure${
        cold ? " (DC 10)" : " (DC 5, one higher each hour; medium or heavy armor or heavy clothing at disadvantage)"
      }; each failure is a level of exhaustion, applied by the server. ${
        cold ? "Cold weather gear or" : "Fire"
      } resistance negates it. Narrate the toll.`,
    };
  }

  // trap / generic: a save-then-damage effect. Each victim gets their own
  // profile (a trap scales to that character's level) and runs through the
  // shared cast_at_player engine, so conditions, resistances, and the save
  // roll are all handled the same way as a monster's breath weapon.
  const halfOnSave = args.halfOnSave ?? true;
  const perTarget = targets.map((sheet) => {
    let saveAbility: string;
    let dc: number;
    let damage: string;
    if (args.type === "trap") {
      const severity: TrapSeverity = args.severity ?? "dangerous";
      const profile = trapProfile(severity, sheet.level ?? 1);
      saveAbility = args.saveAbility ?? profile.saveAbility;
      dc = profile.saveDc;
      damage = profile.damageDice;
    } else {
      saveAbility = args.saveAbility ?? "dex";
      dc = args.dc ?? 13;
      damage = args.damage ?? "";
    }
    const result = handleCastAtPlayer(
      campaign,
      turn,
      JSON.stringify({
        characterId: sheet.id,
        source,
        saveAbility,
        dc,
        damage: damage || undefined,
        damageType,
        halfOnSave,
        condition: args.condition,
      }),
      sheets,
      sheetsById,
    );
    return { name: sheet.name, ...result };
  });

  return {
    ok: true,
    type: args.type,
    ...(args.type === "trap" ? { severity: args.severity ?? "dangerous" } : {}),
    results: perTarget,
    note: "Saves and damage applied by the server; narrate the outcome per character.",
  };
}

// What keeps a character from the weather's toll: resistance to cold or
// fire, or cold weather gear against the cold (the SRD's weather rules).
function exposureShrug(sheet: CharacterSheet, cold: boolean): string | null {
  const wanted = cold ? "cold" : "fire";
  if (pcResistances(sheet).includes(wanted)) {
    return `${wanted} resistance: unaffected by the ${cold ? "cold" : "heat"}`;
  }
  if (cold && sheet.equipment.some((item) => /cold[- ]weather gear|winter (?:clothes|clothing|gear)|fur cloak/i.test(item.name))) {
    return "dressed for the cold: unaffected";
  }
  return null;
}

// Medium or heavy armor, or heavy clothing, puts the heat's saves at
// disadvantage.
function heatHampers(sheet: CharacterSheet): boolean {
  const category = acBreakdownFor(sheet).armor?.category;
  return (
    category === "medium" ||
    category === "heavy" ||
    sheet.equipment.some((item) => /heavy clothing|cold[- ]weather gear|fur cloak/i.test(item.name))
  );
}

function defaultSource(args: z.infer<typeof hazardSchema>): string {
  if (args.type === "falling") return "the fall";
  if (args.type === "trap") return "a trap";
  if (args.type === "suffocation") return "suffocation";
  if (args.type === "drowning") return "drowning";
  return "the hazard";
}
