import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getMounts, setMount } from "@/lib/db/mounts";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { resolveSheetRef } from "@/lib/dm/rolls";
import {
  checkMount,
  describeMount,
  DISMOUNT_SAVE_DC,
  MOUNTS,
  MOUNT_SIZES,
  mountCost,
  type MountSize,
} from "@/lib/srd/mounts";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, moveToken } from "@/lib/db/battle-maps";
import { speedToTiles } from "@/lib/battlemap/movement";
import { publishEphemeral } from "@/lib/events";
import { rollCharacterSave } from "@/lib/dm/forced-save";
import { applyDmMutation } from "@/lib/dm/mutations";

// Getting on and off a horse, with the PHB's rules attached.
//
// Mounted combat was pure DM assertion: a horse was a line of equipment and
// "I ride him down" moved no number. This makes the four things the PHB
// actually says true on the server: the size rule, the mount's speed
// replacing the rider's, the half-movement cost of mounting, and the DC 10
// Dexterity save when something knocks you off.

export const MOUNT_TOOL_NAMES = ["mount_up", "dismount"] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const mountTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "mount_up",
      description: `Put a character on a mount. While mounted they move at the mount's speed rather than their own (the board lets them walk that far), and mounting costs half their movement, taken from their own turn's movement in a fight. A mount must be one size larger than its rider. Known mounts: ${MOUNTS.map((mount) => mount.name).join(", ")}. For anything else, send customName with a speed and a size.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string" },
          mount: { type: "string", description: "A known mount's name." },
          customName: { type: "string", description: "Or a beast of your own." },
          speed: { type: "integer", minimum: 0, maximum: 200, description: "For a custom mount." },
          size: { type: "string", enum: [...MOUNT_SIZES], description: "For a custom mount." },
          controlled: { type: "boolean", description: "Trained to bear a rider: it shares the rider's initiative." },
        },
        required: ["characterId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismount",
      description: `Take a character off their mount. A voluntary dismount costs half their movement (taken from their own turn's movement on the board) and needs no roll. When something threw them, send cause: the server rolls their DC ${DISMOUNT_SAVE_DC} Dexterity save and lays them prone on a failure; do not roll it or set the condition yourself.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string" },
          cause: {
            type: "string",
            enum: ["voluntary", "forced-move", "mount-prone", "rider-prone"],
            description: "Why they came off. Defaults to voluntary.",
          },
        },
        required: ["characterId"],
      },
    },
  },
];

const mountSchema = z.object({
  characterId: z.string(),
  mount: z.string().optional(),
  customName: z.string().optional(),
  speed: z.coerce.number().optional(),
  size: z.enum(MOUNT_SIZES).optional(),
  controlled: z.coerce.boolean().optional(),
});

const dismountSchema = z.object({
  characterId: z.string(),
  cause: z.enum(["voluntary", "forced-move", "mount-prone", "rider-prone"]).optional(),
});

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// A character's own size, which the size rule needs. ODM does not track it on
// the sheet, so the race decides: only the small races are small, everything
// else is medium. Wrong for a goliath, right for the ninety-nine percent, and
// the DM can always write a custom mount.
const SMALL_RACES = ["halfling", "gnome", "goblin", "kobold"];

function riderSize(sheet: CharacterSheet): MountSize {
  return SMALL_RACES.some((race) => sheet.race.toLowerCase().includes(race)) ? "small" : "medium";
}

export function handleMountUp(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  turn?: Pick<DmTurn, "actor">,
): Record<string, unknown> {
  let args: z.infer<typeof mountSchema>;
  try {
    args = mountSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: mount_up needs a characterId and a mount." };
  }
  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const checked = args.customName
    ? checkMount({
        ref: args.customName,
        riderSize: riderSize(sheet),
        custom: {
          name: args.customName,
          speed: args.speed ?? 60,
          controlled: args.controlled !== false,
          size: args.size ?? "large",
        },
      })
    : checkMount({ ref: args.mount ?? "", riderSize: riderSize(sheet) });
  if ("error" in checked) {
    return checked;
  }
  const spent = spendMountingMovement(campaign, sheet, turn);
  if ("error" in spent) {
    return spent;
  }
  setMount(campaign.id, sheet.id, checked.state);
  publishPersisted(campaign.id, "mounts_updated", { mounts: getMounts(campaign.id) });
  tableNote(campaign, `${sheet.name} mounts up: ${describeMount(checked.state)}.`);
  return {
    ok: true,
    mounted: checked.state.name,
    speed: checked.state.speed,
    movementSpent: mountCost(sheet.speed),
    note: `${sheet.name} now moves at ${checked.state.speed} ft. Mounting cost half their movement (${mountCost(sheet.speed)} ft)${spent.charged ? ", taken from this turn's movement on the board" : ""}.`,
  };
}

// Mounting or dismounting costs half the rider's speed, once during their
// move (SRD 5.1, Mounted Combat). In a fight on a board it comes out of the
// movement of the rider's own turn, and without that much left it cannot be
// done this turn. Off their turn there is no movement of theirs to spend (it
// would refill as their turn starts); a person at the console keeps a free
// hand.
function spendMountingMovement(
  campaign: Campaign,
  sheet: CharacterSheet,
  turn?: Pick<DmTurn, "actor">,
): { charged: boolean } | { error: string } {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter?.orderReady ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!encounter || !token) {
    return { charged: false };
  }
  const current = encounter.order[encounter.turnIndex];
  if (turn?.actor !== "human_dm" && (current?.kind !== "pc" || current.characterId !== sheet.id)) {
    return { error: `${sheet.name} mounts or dismounts during their own move only; it is ${current?.name ?? "another combatant"}'s turn.` };
  }
  const half = Math.floor(speedToTiles(sheet.speed) / 2);
  const mounted = getMounts(campaign.id)[sheet.id];
  const full = speedToTiles(mounted ? mounted.speed : sheet.speed);
  if (full - token.movedThisRound < half) {
    return {
      error: `${sheet.name} has too little movement left this turn to ${mounted ? "dismount" : "mount"}: it costs half their speed (${half * 5} ft).`,
    };
  }
  moveToken(token.id, token.x, token.y, token.movedThisRound + half);
  publishEphemeral(campaign.id, "battle_map_updated", {});
  return { charged: true };
}

export function handleDismount(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // The turn the thrown rider's save is rolled on.
  turn?: DmTurn,
): Record<string, unknown> {
  let args: z.infer<typeof dismountSchema>;
  try {
    args = dismountSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: dismount needs a characterId." };
  }
  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const current = getMounts(campaign.id)[sheet.id];
  if (!current) {
    return { error: `${sheet.name} is not mounted.` };
  }
  const cause = args.cause ?? "voluntary";
  if (cause === "voluntary") {
    const spent = spendMountingMovement(campaign, sheet, turn);
    if ("error" in spent) {
      return spent;
    }
  }
  setMount(campaign.id, sheet.id, null);
  publishPersisted(campaign.id, "mounts_updated", { mounts: getMounts(campaign.id) });

  if (cause === "voluntary") {
    tableNote(campaign, `${sheet.name} dismounts.`);
    return {
      ok: true,
      dismounted: current.name,
      movementSpent: mountCost(sheet.speed),
      note: "A deliberate dismount costs half their movement and needs no roll.",
    };
  }
  // Thrown: the server rolls the DC 10 Dexterity save from the rider's sheet
  // and lays them prone on a failure (SRD 5.1, Mounted Combat).
  tableNote(campaign, `${sheet.name} is thrown from ${current.name}.`);
  const save = turn
    ? rollCharacterSave(campaign, turn, sheet, "dex", DISMOUNT_SAVE_DC, `${sheet.name}: DEX save to land on their feet`)
    : null;
  const failed = !save || !save.success;
  if (failed && turn) {
    applyDmMutation(
      campaign,
      turn.id,
      "set_condition",
      JSON.stringify({ characterId: sheet.id, condition: "prone", reason: `thrown from ${current.name}` }),
      sheets,
      sheetsById,
    );
  }
  return {
    ok: true,
    dismounted: current.name,
    save: save?.total ?? "failed automatically",
    dc: DISMOUNT_SAVE_DC,
    ...(failed ? { landed: "prone, within 5 feet of the mount" } : { landed: "on their feet" }),
  };
}
