import type { Campaign } from "@/lib/db/campaigns";
import { ask } from "@/lib/dm/world-ai";
import { replyJson } from "@/lib/worldforge/forge";
import { outlineMessages, readOutlineReply, type Outline, type OutlineAsset } from "@/lib/worldforge/outline";
import { creatureMessages, itemMessages, readCreatureReply, readItemReply } from "@/lib/worldforge/adapters";
import { reservedCreature } from "@/lib/bestiary/reserved-creatures";
import { worldView, createEntryForRecord, updateWorldEntity } from "@/lib/db/world-forge";
import { checkMonsterDraft, describeMonster, draftFromCr, draftFromStats, type MonsterDraft } from "@/lib/bestiary/monster-draft";
import { createHomebrewMonster } from "@/lib/bestiary/homebrew-monsters";
import { parseMonster } from "@/lib/bestiary/statblock";
import { searchMonsters } from "@/lib/content";
import { createHomebrew } from "@/lib/db/homebrew";
import { createHomebrewSchema } from "@/lib/schemas/homebrew";
import { serverPublishedNameProblem } from "@/lib/homebrew/published-names-server";
import { describeHomebrew, normalizeHomebrewData } from "@/lib/homebrew/gear";
import { textKey } from "@/lib/language/text-logic";

// "Draft a world from this idea" (plan M5 item 1, audit WF-08), the model
// half; what an outline is lives in src/lib/worldforge/outline.ts.
//
// draftOutline asks once and writes nothing: the outline comes back for the
// author to review. Its entries are made through the forge's own apply
// (applyForge in src/lib/db/world-forge-io.ts), one at a time. makeAsset
// makes ONE ticked creature or item, and only through the tool that owns it:
// a creature is built the Bestiary's way (an SRD block copied as it stands,
// or the challenge rating's baseline with the model's attacks and traits)
// and must pass checkMonsterDraft; an item must pass Homebrew's create
// schema, its published-name check and normalizeHomebrewData. Anything the
// validators refuse is a failure the author can retry, never stored text.
// Each made thing gets a World entry linked to it. One call makes one
// asset, so an accepted outline never starts more than its ticked rows.

type Failure = { error: string };

export async function draftOutline(campaign: Campaign, idea: string, hint: string): Promise<{ outline: Outline } | Failure> {
  const { doc, entities } = worldView(campaign.id);
  const reply = await ask(campaign, outlineMessages({ idea, worldName: campaign.title, types: doc.types, known: entities.map((entity) => entity.name), hint }));
  if (typeof reply !== "string") return reply;
  const outline = readOutlineReply(replyJson(reply), doc, entities.map((entity) => ({ ref: entity.ref, name: entity.name, aliases: entity.aliases })));
  return outline.entries.length || outline.assets.length ? { outline } : { error: "The model did not answer with an outline. Try again, or say more about the idea." };
}

// One made asset: where it lives, its own record, and its World entry (or
// why that entry could not be made, the asset being made all the same).
export type MadeAsset = {
  kind: "creature" | "item";
  name: string;
  id: string;
  lands: "Bestiary" | "Homebrew";
  detail: string;
  entryRef: string;
  entryError: string;
};

// Where a failure happened, so the page can say whether a retry asks the
// model again (it always does) and what to change first.
export type AssetFailure = { error: string; stage: "model" | "check" | "save" };

export async function makeAsset(campaign: Campaign, userId: string, asset: Pick<OutlineAsset, "kind" | "name" | "summary" | "cr" | "basis" | "itemKind">, premise: string): Promise<{ made: MadeAsset } | AssetFailure> {
  const reserved = reservedCreature(asset.name, asset.basis);
  if (asset.kind === "creature" && reserved) {
    return { stage: "check", error: `“${asset.name}” reads as a ${reserved}, which is not a creature ODM makes. Rename it, or pick a creature from the SRD.` };
  }
  const context = premise ? [`The world: ${premise}`] : [];
  return asset.kind === "creature" ? makeCreature(campaign, userId, asset, context) : makeItem(campaign, userId, asset, context);
}

// An SRD block by its exact name, from the content pack's SRD document
// only: another book in the pack is not the SRD, and a fuzzy match would
// copy a monster nobody named. Without a pack there is no block to copy.
function srdBlock(name: string): { name: string; stats: ReturnType<typeof parseMonster> } | null {
  if (!name) return null;
  try {
    const entry = searchMonsters({ q: name, limit: 10 }).find((row) => row.source === "open5e" && row.documentSlug === "wotc-srd" && textKey(row.name) === textKey(name));
    if (!entry) return null;
    const cr = typeof entry.data.cr === "number" ? entry.data.cr : 0;
    return { name: entry.name, stats: parseMonster(entry.data, cr) };
  } catch {
    return null;
  }
}

async function makeCreature(campaign: Campaign, userId: string, asset: Pick<OutlineAsset, "name" | "summary" | "cr" | "basis">, context: string[]): Promise<{ made: MadeAsset } | AssetFailure> {
  const reply = await ask(campaign, creatureMessages({ worldName: campaign.title, name: asset.name, summary: asset.summary, cr: asset.cr, basis: asset.basis, context }));
  if (typeof reply !== "string") return { stage: "model", error: reply.error };
  const parsed = replyJson(reply);
  if (!parsed) return { stage: "model", error: "The model did not answer with a stat block." };
  const read = readCreatureReply(parsed);
  const reserved = reservedCreature(read.basis, read.desc);
  if (reserved) {
    return { stage: "check", error: `The model drew ${asset.name} as a ${reserved}, which is not a creature ODM makes. Retry, or rename it.` };
  }
  // A basis the SRD has is copied as it stands; anything else is an
  // original at its rating's baseline, carrying the model's own lines.
  const block = srdBlock(read.basis) ?? srdBlock(asset.basis);
  const start: MonsterDraft = block ? draftFromStats(asset.name, block.stats) : draftFromCr(asset.name, asset.cr);
  const sent = block ? { ...start.stats, name: asset.name } : { ...start.stats, ...read.fields, name: asset.name, cr: asset.cr };
  const checked = checkMonsterDraft(sent);
  if ("error" in checked) return { stage: "check", error: `The Bestiary refused ${asset.name}: ${checked.error}` };
  const desc = read.desc || asset.summary;
  const monster = createHomebrewMonster(userId, checked.draft, desc);
  const detail = `${block ? `From the SRD's ${block.name}, ` : ""}${describeMonster(checked.draft)}`;
  return { made: { kind: "creature", name: monster.draft.name, id: monster.id, lands: "Bestiary", detail, ...worldEntryFor(campaign.id, "monster", monster.id, desc) } };
}

async function makeItem(campaign: Campaign, userId: string, asset: Pick<OutlineAsset, "name" | "summary" | "itemKind">, context: string[]): Promise<{ made: MadeAsset } | AssetFailure> {
  const published = serverPublishedNameProblem("item", asset.name);
  if (published) return { stage: "check", error: `${published} Rename it, then retry.` };
  const reply = await ask(campaign, itemMessages({ worldName: campaign.title, name: asset.name, summary: asset.summary, itemKind: asset.itemKind, context }));
  if (typeof reply !== "string") return { stage: "model", error: reply.error };
  const parsed = replyJson(reply);
  if (!parsed) return { stage: "model", error: "The model did not answer with an item." };
  const data = readItemReply(parsed, asset.itemKind);
  if (!data.desc) data.desc = asset.summary;
  const schema = createHomebrewSchema.safeParse({ kind: "item", name: asset.name, data });
  if (!schema.success) return { stage: "check", error: `Homebrew refused ${asset.name}: ${schema.error.issues[0]?.path.join(".") || "its fields"} is not something an item can hold.` };
  const normalized = normalizeHomebrewData("item", schema.data.data, schema.data.name);
  if ("error" in normalized) return { stage: "check", error: `Homebrew refused ${asset.name}: ${normalized.error}` };
  const entry = createHomebrew(userId, { kind: "item", name: schema.data.name, data: normalized.data });
  return {
    made: { kind: "item", name: entry.name, id: entry.id, lands: "Homebrew", detail: describeHomebrew("item", entry.data), ...worldEntryFor(campaign.id, "item", entry.id, String(entry.data.desc ?? "")) },
  };
}

// "Give it a World entry", the bindings route's own door, then the outline's
// words as its text.
function worldEntryFor(campaignId: string, kind: "monster" | "item", id: string, text: string): { entryRef: string; entryError: string } {
  const made = createEntryForRecord(campaignId, { kind, ref: `homebrew:${id}` });
  if ("error" in made) return { entryRef: "", entryError: made.error };
  if (text) updateWorldEntity(campaignId, made.entity.ref, { text: text.slice(0, 4_000) });
  return { entryRef: made.entity.ref, entryError: "" };
}
