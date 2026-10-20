import { z } from "zod";
import { campaignCreationRefusal, canCreateCampaigns } from "@/lib/shared-host";
import { currentUser, unauthorized } from "@/lib/auth";
import { importWorkshopBundle } from "@/lib/db/workshop-bundle";
import { sharedHomesFor } from "@/lib/db/workshop-bundle-parts";
import { uploadRefusalResponse } from "@/lib/upload-budget";
import { applyWorldImport } from "@/lib/db/world-forge-io";
import { importedBundleText } from "@/lib/addons/run-importer";
import { taskFor } from "@/lib/addons/tasks";
import type { WorldImport } from "@/lib/worldforge/format";
import { sceneLossLines } from "@/lib/worldforge/scenes";
import {
  bundleCounts,
  bundleDependencies,
  bundleWarnings,
  MAX_BUNDLE_BYTES,
  pickBundleKinds,
  readBundle,
} from "@/lib/workshop/bundle";
import { MAX_ADDON_BUNDLE_BYTES } from "@/lib/workshop/bundle-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Somebody else's workshop, arriving as a file.
//
// SECURITY: this is the one route in the app that takes a whole content tree
// from a stranger. Three things stand between it and the database:
//
//   1. The body is capped before it is read as a bundle. `text` is a string
//      with a Zod max, so an oversized upload is refused by its length and
//      never reaches JSON.parse.
//   2. readBundle validates every field, every length and every array size
//      against workshopBundleSchema before a single row is written.
//   3. The import CREATES a new workshop owned by the person who uploaded
//      it. It cannot write into an existing campaign, so a malicious bundle
//      has nothing of theirs to corrupt, and a workshop runs no AI turns
//      (src/lib/workshop/kind.ts), so nothing it contains can start acting.
//
// `preview: true` runs steps 1 and 2 and stops, so a DM can read what they
// were sent, and its warnings, before anything is written.
//
// `addonTask` instead of `text` takes the bundle a workshop importer addon
// made (src/lib/addons/run-importer.ts) from the finished run of the person
// asking, so a rulebook read by an addon passes the very same three steps.

const bodySchema = z.object({
  // A little headroom over the byte cap, since readBundle measures the true
  // encoded size and this measures characters.
  text: z.string().min(1).max(MAX_BUNDLE_BYTES).optional(),
  addonTask: z.string().min(1).max(60).optional(),
  preview: z.boolean().default(false),
  // The kinds to take. Absent or empty means the whole bundle.
  kinds: z.array(z.string().max(40)).max(20).default([]),
  // For a chapter bundle: the importer's workshop its shared rows link to
  // (#159). Checked against ownership where it is used.
  sharedWorkshopId: z.string().trim().max(80).default(""),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (!canCreateCampaigns(user)) {
    return campaignCreationRefusal();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "That file is empty or too large." }, { status: 400 });
  }

  let text = parsed.data.text ?? "";
  if (parsed.data.addonTask) {
    const task = taskFor(parsed.data.addonTask, user);
    const made = task && task.userId === user.id ? await importedBundleText(task) : null;
    if (!made) {
      return Response.json({ error: "That addon run has no workshop waiting. Run the import again." }, { status: 404 });
    }
    text = made;
  }
  if (!text) {
    return Response.json({ error: "That file is empty or too large." }, { status: 400 });
  }
  // An addon's bundle was made and checked on this server, with room for
  // its pictures (src/lib/addons/run-importer.ts); a pasted one is held to
  // the file cap.
  const read = readBundle(text, parsed.data.addonTask ? { maxBytes: MAX_ADDON_BUNDLE_BYTES } : {});
  if ("error" in read) {
    return Response.json({ error: read.error }, { status: 400 });
  }
  const { bundle } = read;

  if (parsed.data.preview) {
    return Response.json({
      manifest: bundle.manifest,
      counts: read.worldForge ? { ...bundleCounts(bundle), ...worldForgeCounts(read.worldForge) } : bundleCounts(bundle),
      houseRules: bundle.houseRulesText.trim().length > 0,
      // The two single things a bundle can carry besides its lists, offered
      // as ticks like the rest (the plugin draft was never offered, so it
      // was dropped from every import that ticked anything).
      plugin: Boolean(bundle.plugin),
      overworld: Boolean(bundle.overworld),
      // What leans on what, so the ticks can say which links an untick
      // drops (#158).
      dependencies: bundleDependencies(bundle),
      // For a chapter bundle: the shared workshop it was written against,
      // and the importer's workshops that hold its shared rows.
      dependsOn: bundle.dependsOn,
      sharedHomes: sharedHomesFor(user.id, bundle),
      // A WorldForge file names what it would not bring in whole, and what
      // it brings in differently, before the workshop is made.
      warnings: [
        ...bundleWarnings(bundle),
        ...(read.worldForge?.losses ?? []),
        ...sceneLossLines(read.worldForge?.sceneLosses ?? []),
        ...(read.worldForge?.notes ?? []),
      ],
    });
  }

  const result = importWorkshopBundle(user.id, pickBundleKinds(bundle, parsed.data.kinds), {
    isAdmin: user.isAdmin,
    sharedWorkshopId: parsed.data.sharedWorkshopId,
  });
  if ("error" in result) {
    return result.refusal
      ? uploadRefusalResponse(result.refusal)
      : Response.json({ error: result.error }, { status: 400 });
  }
  if (read.worldForge) {
    // The workshop exists; now the world goes into its WorldForge whole.
    const world = applyWorldImport(result.workshopId, { id: user.id, isAdmin: user.isAdmin }, read.worldForge);
    if ("error" in world) {
      return world.refusal ? uploadRefusalResponse(world.refusal) : Response.json({ error: world.error }, { status: 400 });
    }
    return Response.json({ ...result, copied: result.copied + world.created, world });
  }
  return Response.json(result);
}

// What a WorldForge file holds, in the preview's own words.
function worldForgeCounts(world: WorldImport): Record<string, number> {
  const count = (shelf: string) => world.records.filter((record) => record.shelf === shelf).length;
  return { npcs: count("npc"), locations: count("location"), lore: count("lore"), storyboard: world.beats.length };
}
