import { z } from "zod";
import { cueById, cueIds } from "@/lib/ambience/catalog";
import {
  applyAuto,
  describeAmbience,
  inferBedCue,
  setCue,
  type AmbienceState,
} from "@/lib/ambience/logic";
import { getAmbience, setAmbience } from "@/lib/db/ambience";
import type { Campaign } from "@/lib/db/campaigns";
import { publishEphemeral, publishPersisted } from "@/lib/events";

// Sound at the table: the engine rim around src/lib/ambience/logic.ts.
//
// Every way the ambience can change goes through commit() below, so there is
// exactly one place that writes the row and exactly one that announces it.
// That matters more here than in most tool modules because the callers are
// so different: a tool call from the model, a form from a human DM, and two
// automatic hooks that fire from inside other handlers. Three of the four
// must be silent no-ops when the table has the sound library switched off,
// and one gate is easier to keep right than four.
//
// Imports nothing from the encounter or turn layers: those import THIS, to
// swap the music when a fight starts.

export const AMBIENCE_TOOL_NAMES = ["set_ambience", "play_sting"] as const;

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

// "none" is how a select, and a model, say silence. An omitted layer is not
// the same thing: it means leave that layer alone.
const SILENCE = "none";

export const ambienceTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "set_ambience",
      description:
        "Change what the table is hearing. The bed is the place (a tavern, a cave, rain); the music is what the scene is doing to them (tension, triumph, sorrow). Call this when the party arrives somewhere that sounds different or the mood of the scene turns, not every reply. Leave a layer out to keep it as it is, or send \"none\" to silence it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          bed: {
            type: "string",
            enum: [...cueIds("bed"), SILENCE],
            description: "Where they are.",
          },
          music: {
            type: "string",
            enum: [...cueIds("music"), SILENCE],
            description: "What the scene is doing to them.",
          },
          hold: {
            type: "boolean",
            description:
              "Keep this playing until you change it again: the engine stops following the scene on its own. Use it when the sound is the point (a ritual, a siege), not for ordinary travel.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "play_sting",
      description:
        "One sound, once, over whatever is already playing: a thunderclap, a door slamming, a roar out of the dark. Use it for a single beat you want the table to flinch at. It changes nothing about the scene's ambience.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          cue: { type: "string", enum: cueIds("sting") },
        },
        required: ["cue"],
      },
    },
  },
];

const setSchema = z.object({
  bed: z.string().optional(),
  music: z.string().optional(),
  hold: z.coerce.boolean().optional(),
});

const stingSchema = z.object({ cue: z.string() });

function enabled(campaign: Campaign): boolean {
  return campaign.gameSettings.ambienceEnabled;
}

// The single writer. Saves and announces only when something actually
// changed, so a model that calls set_ambience with the cue already playing
// costs one tool result and no event.
function commit(campaignId: string, next: AmbienceState, changed: boolean): boolean {
  if (!changed) {
    return false;
  }
  const stamped = { ...next, updatedAt: new Date().toISOString() };
  setAmbience(campaignId, stamped);
  // Persisted: a player who reloads or reconnects mid-scene must land in the
  // cave they are standing in, not in silence until the next place change.
  publishPersisted(campaignId, "ambience_changed", { ambience: stamped });
  return true;
}

// A layer argument: undefined leaves it alone, "none" silences it, anything
// else is a cue id the catalog has to recognize.
function layerArg(value: string | undefined): string | null | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value.trim() === SILENCE ? null : value.trim();
}

export function handleSetAmbience(
  campaign: Campaign,
  rawArguments: string,
): Record<string, unknown> {
  if (!enabled(campaign)) {
    return { error: "This table has the sound library switched off." };
  }
  let args: z.infer<typeof setSchema>;
  try {
    args = setSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: set_ambience takes a bed, a music cue, or both." };
  }
  const bed = layerArg(args.bed);
  const music = layerArg(args.music);
  if (bed === undefined && music === undefined) {
    return { error: "set_ambience needs a bed or a music cue to change." };
  }
  for (const [layer, value] of [
    ["bed", bed],
    ["music", music],
  ] as const) {
    if (typeof value === "string" && cueById(value)?.layer !== layer) {
      return { error: `"${value}" is not a ${layer} cue. Use one from the list.` };
    }
  }

  let state = getAmbience(campaign.id);
  let changed = false;
  for (const [layer, value] of [
    ["bed", bed],
    ["music", music],
  ] as const) {
    if (value === undefined) {
      continue;
    }
    const applied = setCue(state, layer, value, { hold: args.hold });
    state = applied.state;
    changed = changed || applied.changed;
  }
  if (!commit(campaign.id, state, changed)) {
    return { ok: true, note: "That is already what is playing.", playing: describeAmbience(state) };
  }
  return {
    ok: true,
    playing: describeAmbience(state),
    ...(args.hold ? { note: "Held: the engine will not change this on its own." } : {}),
  };
}

export function handlePlaySting(
  campaign: Campaign,
  rawArguments: string,
): Record<string, unknown> {
  if (!enabled(campaign)) {
    return { error: "This table has the sound library switched off." };
  }
  let args: z.infer<typeof stingSchema>;
  try {
    args = stingSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: play_sting needs a cue." };
  }
  const cue = cueById(args.cue);
  if (!cue || cue.layer !== "sting") {
    return { error: `"${args.cue}" is not a sting. Use one from the list.` };
  }
  // Ephemeral by nature: a sting is only true while it is happening, so a
  // client that reconnects a minute later must not be made to jump.
  publishEphemeral(campaign.id, "ambience_sting", { cue: cue.id, at: Date.now() });
  return { ok: true, played: cue.label };
}

// ---- the automatic half ----

// The party arrived somewhere. Reads the place for a bed and takes it,
// unless the table turned scene-following off or is holding the layer.
// Called from handleLocationCall, so it fires for the AI DM, for a human
// DM's console form and for anything else that moves the party.
export function followSceneAmbience(campaign: Campaign, placeText: string) {
  if (!enabled(campaign) || !campaign.gameSettings.ambienceAuto) {
    return;
  }
  const bed = inferBedCue(placeText);
  if (!bed) {
    // Nothing in the description says anything about sound. Leaving the
    // previous bed alone beats cutting to silence: the party walking into an
    // unnamed room has not left the dungeon.
    return;
  }
  const { state, changed } = applyAuto(getAmbience(campaign.id), { bed });
  commit(campaign.id, state, changed);
}

// Initiative started or the fight ended. Combat music goes on at the start
// and comes off at the end; the bed is left alone, because the cave they are
// fighting in is still a cave.
export function followCombatAmbience(campaign: Campaign, fighting: boolean, deadly = false) {
  if (!enabled(campaign) || !campaign.gameSettings.ambienceAuto) {
    return;
  }
  const music = fighting ? (deadly ? "boss" : "battle") : null;
  const { state, changed } = applyAuto(getAmbience(campaign.id), { music });
  commit(campaign.id, state, changed);
}
