import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { ambienceLibraryStatus, installAmbiencePack, rescanAmbienceLibrary } from "@/lib/ambience/install";
import packageJson from "../../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The sound library, for admins: GET reports how much of the catalog has
// audio and how a pack download is going; POST starts one (from the release
// asset for this version unless a URL is given) or rescans the folder after
// files were dropped in by hand. The admin panel's Sound library card polls
// GET while a pack comes down.
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json(ambienceLibraryStatus(packageJson.version));
}

const bodySchema = z.object({
  action: z.enum(["install", "rescan"]).default("install"),
  url: z.string().url().max(500).optional(),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Give a pack URL or leave it out for the release pack." }, { status: 400 });
  }
  const version = packageJson.version;
  if (parsed.data.action === "rescan") {
    return Response.json(rescanAmbienceLibrary(version));
  }
  const url = parsed.data.url ?? ambienceLibraryStatus(version).packUrl;
  if (!/^https?:\/\//.test(url)) {
    return Response.json({ error: "The pack URL has to be http or https." }, { status: 400 });
  }
  return Response.json(installAmbiencePack(url, version));
}
