import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { importWorkshopBundle } from "@/lib/db/workshop-bundle";
import {
  bundleCounts,
  bundleWarnings,
  MAX_BUNDLE_BYTES,
  readBundle,
} from "@/lib/workshop/bundle";

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

const bodySchema = z.object({
  // A little headroom over the byte cap, since readBundle measures the true
  // encoded size and this measures characters.
  text: z.string().min(1).max(MAX_BUNDLE_BYTES),
  preview: z.boolean().default(false),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "That file is empty or too large." }, { status: 400 });
  }

  const read = readBundle(parsed.data.text);
  if ("error" in read) {
    return Response.json({ error: read.error }, { status: 400 });
  }
  const { bundle } = read;

  if (parsed.data.preview) {
    return Response.json({
      manifest: bundle.manifest,
      counts: bundleCounts(bundle),
      warnings: bundleWarnings(bundle),
    });
  }

  const result = importWorkshopBundle(user.id, bundle);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result);
}
