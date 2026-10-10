import type { Campaign } from "@/lib/db/campaigns";
import { listEncounterTemplates, setTemplateCued, type EncounterTemplate } from "@/lib/db/encounter-templates";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getPreparedMap } from "@/lib/db/prepared-maps";
import { describeExtras, formatRoster } from "@/lib/dm/encounter-template-logic";
import { applyTemplateExtras, applyTemplateMap } from "@/lib/dm/template-apply";
import type { ToolDef } from "@/lib/dm/encounter-tool-defs";

// The prepared fights, offered to the AI storyteller (#154).
//
// A DM at a table a person runs deploys a prepared fight from the console.
// At an AI-narrated table the storyteller runs the fights, and until now it
// could not see the prepared ones at all: its prompt never listed them and
// start_encounter takes a roster, not a name. So a workshop's fights,
// imported with their maps and plans, sat in a drawer the narrator could not
// open. This module is the drawer handle: the prepared fights appear in the
// storyteller's game state, and run_prepared_encounter starts one by name
// through the same start_encounter the model already uses, then lays down
// the fight's saved map and the rest of its plan exactly as a DM's Deploy
// does (src/lib/dm/template-apply.ts).
//
// The lead of an AI table cues one from the lead's desk
// (src/app/api/campaigns/[campaignId]/dm/encounter-templates/[templateId]/
// deploy/route.ts): a flag on the fight, listed first and marked in the
// storyteller's game state until it runs. A flag rather than a lead
// direction, because a direction is posted in the transcript and the name
// of the fight waiting for the party is exactly what the players must not
// read. A storyboard fight card arrives as a beat whose waypoint names the
// same fight.

export const RUN_PREPARED_ENCOUNTER = "run_prepared_encounter";

// At most this many are listed, newest work first by name order; a longer
// drawer is still reachable by name.
const LISTED = 8;

// The fights the storyteller can run: the ones with a roster. A placeholder
// a storyboard card made (no monsters yet) is the DM's to finish first.
export function readyTemplates(campaignId: string): EncounterTemplate[] {
  return listEncounterTemplates(campaignId).filter((template) =>
    template.enemies.some((row) => typeof row.monster === "string" && row.monster.trim()),
  );
}

export function preparedEncounterTools(campaign: Campaign): ToolDef[] {
  return readyTemplates(campaign.id).length ? [runPreparedEncounterTool] : [];
}

export const runPreparedEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: RUN_PREPARED_ENCOUNTER,
    description:
      "Start one of the PREPARED FIGHTS listed in GAME STATE by its name, instead of start_encounter, when the scene reaches it. The server fills in its roster, lays out its saved battle map and opening positions, and notes what it is worth; you narrate the fight as usual.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "The prepared fight's name, exactly as listed." },
        ambush: {
          type: "string",
          enum: ["enemies", "party"],
          description: "Who was lying in wait, as for start_encounter.",
        },
        surprised: {
          type: "string",
          enum: ["none", "enemies", "party"],
          description: "A whole side caught off guard, as for start_encounter.",
        },
        distanceFeet: {
          type: "integer",
          minimum: 5,
          description: "How far the nearest enemy stands as it opens, when the story has said.",
        },
      },
      required: ["name"],
    },
  },
};

// The block in GAME STATE. Empty when there is nothing to run or a fight is
// already on, so a table without prep pays nothing for this.
export function preparedFightsBlock(campaign: Campaign): string {
  if (getActiveEncounter(campaign.id)) {
    return "";
  }
  const ready = readyTemplates(campaign.id);
  if (!ready.length) {
    return "";
  }
  // Cued fights first: the lead asked for those.
  const ordered = [...ready.filter((template) => template.cued), ...ready.filter((template) => !template.cued)];
  const lines = ordered.slice(0, LISTED).map((template) => {
    const map = template.map.mapId ? getPreparedMap(campaign.id, template.map.mapId)?.name : "";
    const plan = describeExtras(template.extras)[0] ?? "";
    const note = template.notes.split("\n")[0]?.trim().slice(0, 120) ?? "";
    return `- ${template.cued ? "[CUED by the party lead: run this one as soon as the scene allows] " : ""}${template.name}: ${formatRoster(template.enemies)}${template.battlefield ? ` | ${template.battlefield.slice(0, 100)}` : ""}${map ? ` | on the map "${map}"` : ""}${note ? ` | ${note}` : ""}${plan ? ` | ${plan.slice(0, 100)}` : ""}`;
  });
  const more = ready.length > LISTED ? `\n(${ready.length - LISTED} more are prepared; run any by its exact name.)` : "";
  return `Prepared fights (secret; the table's prep. When the story reaches one, start it with ${RUN_PREPARED_ENCOUNTER} rather than inventing a roster):\n${lines.join("\n")}${more}`;
}

function findTemplate(campaignId: string, name: string): EncounterTemplate | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  const ready = readyTemplates(campaignId);
  return (
    ready.find((template) => template.name.trim().toLowerCase() === wanted) ??
    ready.find((template) => template.name.toLowerCase().includes(wanted) || wanted.includes(template.name.toLowerCase())) ??
    null
  );
}

// Starts the named fight through `start` (start_encounter as the
// encounter tools run it), then lays down its map and plan. A refusal from
// start_encounter (a fight already on, too deadly, an unknown monster) is
// returned as it came, so the model reads the same sentence it would have.
export function runPreparedEncounter(
  campaign: Campaign,
  rawArguments: string,
  start: (rawArguments: string) => Record<string, unknown>,
): Record<string, unknown> {
  // A weak tool caller sends null, an array or a bare string as often as an
  // object; each reads as no arguments and earns the refusal below.
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(rawArguments || "{}");
    args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    args = {};
  }
  const template = findTemplate(campaign.id, typeof args.name === "string" ? args.name : "");
  if (!template) {
    const names = readyTemplates(campaign.id).map((entry) => entry.name);
    return {
      error: names.length
        ? `No prepared fight is called that. The prepared fights are: ${names.slice(0, 12).join(", ")}.`
        : "There are no prepared fights at this table; use start_encounter.",
    };
  }
  const started = start(
    JSON.stringify({
      enemies: template.enemies,
      summary: template.notes.split("\n")[0]?.slice(0, 200) || template.name,
      ...(template.map.scene ? { scene: template.map.scene } : {}),
      ...(args.ambush ? { ambush: args.ambush } : {}),
      ...(args.surprised ? { surprised: args.surprised } : {}),
      ...(typeof args.distanceFeet === "number" ? { distanceFeet: args.distanceFeet } : {}),
    }),
  );
  if (typeof started.error === "string") {
    return started;
  }
  const mapError = applyTemplateMap(campaign, template);
  applyTemplateExtras(campaign, campaign.ownerUserId, template);
  setTemplateCued(template.id, false);
  // The plan rides back with the fight: what it is worth and when it
  // turns, so the storyteller can pay it out and play its phases.
  const plan = describeExtras(template.extras);
  return {
    ...started,
    prepared: template.name,
    ...(plan.length ? { plan } : {}),
    ...(mapError ? { mapNote: `Its saved map could not be used (${mapError}); the fight is on a generated one.` } : {}),
  };
}
