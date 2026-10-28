import { z } from "zod";
import { ADDON_PERMISSION_IDS, addonIdSchema, type AddonPermission } from "@/lib/addons/manifest";

// The addon catalog: addons/catalog.json in the Open Game Master
// repository, the downloader list under Admin > Addons. Addons live in their
// authors' own GitHub repositories; an author adds theirs with a pull
// request to this repository, which is audited before it is merged
// (docs/addons/guidelines.md). An operator can point a server at another
// catalog in the same format, or at none.
//
// An entry pins an addon by the exact files that were audited: the
// repository, the folder holding addon.json, the commit, and a hash of the
// folder's files at that commit (archive.ts archiveContentHash). The server
// downloads that commit from GitHub, checks the hash before unpacking
// anything, and checks that the manifest inside names the same id and
// version. A mismatch installs nothing.
//
// Client-safe, so the admin panel types its catalog from the same schema.

export const ADDON_REGISTRY_KIND = "odm.addons";
export const ADDON_REGISTRY_VERSION = 1;

export const registryAddonSchema = z.object({
  id: addonIdSchema,
  name: z.string().trim().min(1).max(60),
  version: z.string().trim().min(1).max(50),
  apiVersion: z.number().int().min(1),
  description: z.string().trim().max(300).default(""),
  author: z.string().trim().max(80).default(""),
  homepage: z.string().max(300).default(""),
  license: z.string().trim().max(60).default(""),
  // A shelf for the catalog to group by.
  category: z.enum(["maps", "content", "table", "tools"]).default("tools"),
  platforms: z.array(z.enum(["linux", "win32", "darwin"])).max(3).optional(),
  runtime: z.enum(["node", "python", "executable"]).default("node"),
  // Programs it needs installed, by name ("blender", "python3"), shown
  // before download.
  needs: z.array(z.string().trim().max(60)).max(8).default([]),
  permissions: z
    .array(z.string())
    .max(10)
    .default([])
    .transform((list) => list.filter((value): value is AddonPermission => (ADDON_PERMISSION_IDS as string[]).includes(value))),
  // What it adds, by kind, in its own titles ("Rulebook PDF").
  contributes: z
    .object({
      workshopImporters: z.array(z.string().max(60)).max(10).default([]),
      mapGenerators: z.array(z.string().max(60)).max(10).default([]),
      boardViews: z.array(z.string().max(60)).max(5).default([]),
    })
    .default({ workshopImporters: [], mapGenerators: [], boardViews: [] }),
  minServerVersion: z.string().max(50).optional(),
  // Where the addon lives: its author's GitHub repository, the folder holding
  // addon.json (for a repository that holds more than the addon), and the
  // commit that was audited. The panel shows the GitHub user and links here.
  source: z.object({
    repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
    path: z
      .string()
      .max(200)
      .regex(/^(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/)
      .refine((value) => !value.split("/").some((part) => part === "." || part === ".."), "A folder inside the repository.")
      .default(""),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    tag: z.string().max(100).default(""),
  }),
  // The hash of the folder's files at that commit, and their size unpacked:
  // what the server checks a download against, and what the panel shows.
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(1),
  // Roughly how much its setup downloads and writes, in MB.
  setupMB: z.number().int().min(0).max(200_000).default(0),
  // From its manifest: addons it cannot run beside, and the shared
  // resources it takes turns for, shown before it is installed.
  conflicts: z
    .array(z.object({ id: z.string().max(60), reason: z.string().trim().max(200) }))
    .max(10)
    .default([]),
  exclusive: z.array(z.string().max(30)).max(8).default([]),
});

export type RegistryAddon = z.infer<typeof registryAddonSchema>;

// The GitHub user or organization an addon comes from, and the page of the
// exact source that was audited.
export function sourceFacts(source: RegistryAddon["source"] | undefined): { owner: string; repo: string; url: string } | null {
  if (!source) return null;
  const [owner] = source.repo.split("/");
  const folder = source.path ? `/${source.path.split("/").map(encodeURIComponent).join("/")}` : "";
  return { owner, repo: source.repo, url: `https://github.com/${source.repo}/tree/${source.commit}${folder}` };
}

export const addonRegistrySchema = z.object({
  kind: z.literal(ADDON_REGISTRY_KIND),
  version: z.literal(ADDON_REGISTRY_VERSION),
  generated: z.string().max(40).default(""),
  addons: z.array(registryAddonSchema).max(500).default([]),
});

export type AddonRegistry = z.infer<typeof addonRegistrySchema>;
