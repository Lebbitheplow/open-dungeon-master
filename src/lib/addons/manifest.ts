import { z } from "zod";

// The addon manifest: the addon.json at the root of every addon package
// (docs/addons/authoring.md is the author's reference for each field).
//
// An addon is a program that runs beside the server and speaks MCP over its
// stdin and stdout. It changes the app only through the extension points
// declared under `contributes`, each of which has a typed contract
// (src/lib/addons/contracts.ts). Addons propose; the server checks what they
// return against the same schemas its own features use and writes it through
// its own code, so an addon can never put a row the rules engine would not
// accept.
//
// Client-safe: zod and nothing else, so the admin panel, the checker
// (scripts/check-addon.mjs) and the catalog tool read the same schema.

// The contract version this server speaks. A manifest names the one it was
// written against; a server refuses an addon from a newer contract rather
// than guess what it means. Bump only for a breaking change to a contract,
// and keep reading the older numbers for as long as practical.
export const ADDON_API_VERSION = 1;
export const SUPPORTED_ADDON_API_VERSIONS: readonly number[] = [1];

// Lowercase words joined by single hyphens. It is also a folder name and a
// URL segment, so it is held hard rather than cleaned up.
export const ADDON_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const ADDON_ID_MAX = 50;

// A contribution's id, a setting's key, an option's key.
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// An MCP tool name, as the specification allows them.
const TOOL = /^[A-Za-z0-9_.-]{1,64}$/;
// A file inside the package: forward slashes, no "..", no leading slash or
// drive, nothing hidden. Checked again against the real folder on disk.
const PACKAGE_PATH = /^(?![\\/])(?!.*(?:^|[\\/])\.)(?!.*\\)(?![A-Za-z]:)[A-Za-z0-9_\-./]{1,200}$/;
// Major.minor.patch, an optional pre-release tag.
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,40})?$/;

// A shared resource's name, for `exclusive`.
export const EXCLUSIVE_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Names the server's own routes use beside addon ids (/api/addons/uploads).
const RESERVED_IDS = ["uploads", "tasks", "registry", "catalog"];

export const addonIdSchema = z
  .string()
  .min(3)
  .max(ADDON_ID_MAX)
  .regex(ADDON_ID, "Use lowercase words joined by hyphens.")
  .refine((id) => !RESERVED_IDS.includes(id), "That id is reserved by the server.");
const packagePathSchema = z.string().regex(PACKAGE_PATH, "A path inside the package, with forward slashes.");

// What an addon may ask for. `enforced` permissions are a door the server
// holds shut until the admin agrees; the rest describe what a local program
// can do anyway, so the admin knows before enabling it. The admin accepts
// the whole list at once; an update that adds one waits for a new yes.
export const ADDON_PERMISSIONS = {
  "ai.text": {
    label: "Use this server's storyteller model",
    detail: "Sends text to the model the admin configured and reads its replies. Counted under Usage like any other call.",
    enforced: true,
  },
  network: {
    label: "Reach the internet",
    detail: "Downloads or calls web services on its own, for example to fetch a model the first time it runs.",
    enforced: false,
  },
  programs: {
    label: "Run other programs on this computer",
    detail: "Starts programs installed here, such as Blender or Python, to do its work.",
    enforced: false,
  },
} as const;

export type AddonPermission = keyof typeof ADDON_PERMISSIONS;
export const ADDON_PERMISSION_IDS = Object.keys(ADDON_PERMISSIONS) as AddonPermission[];

// One field the app draws a control for: an addon's own settings (the admin
// fills them in once) or a contribution's options (asked each time it runs).
// The server keeps the values; the addon reads settings from
// ODM_ADDON_SETTINGS and options from the call.
const choiceSchema = z.object({
  value: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(60),
});

const fieldBase = {
  key: z.string().regex(KEY),
  label: z.string().trim().min(1).max(60),
  help: z.string().trim().max(240).default(""),
};

const textField = z.object({ ...fieldBase, type: z.literal("text"), default: z.string().max(500).default(""), maxLength: z.number().int().min(1).max(4_000).default(200) });
const textareaField = z.object({ ...fieldBase, type: z.literal("textarea"), default: z.string().max(4_000).default(""), maxLength: z.number().int().min(1).max(20_000).default(2_000) });
const numberField = z.object({
  ...fieldBase,
  type: z.literal("number"),
  default: z.number().default(0),
  min: z.number().default(0),
  max: z.number().default(1_000_000),
  step: z.number().positive().default(1),
});
const booleanField = z.object({ ...fieldBase, type: z.literal("boolean"), default: z.boolean().default(false) });
const selectField = z.object({ ...fieldBase, type: z.literal("select"), choices: z.array(choiceSchema).min(1).max(30), default: z.string().max(60).default("") });

export const optionFieldSchema = z.discriminatedUnion("type", [textField, textareaField, numberField, booleanField, selectField]);

export type OptionField = z.infer<typeof optionFieldSchema>;

// Settings add two kinds an option never needs: a secret (stored, sent to the
// addon, never shown again) and a path to a program or folder. And two
// flags about setup (src/lib/addons/setup.ts):
//
//   required      the addon cannot be set up or used until it has a value
//                 (an API key, the folder of a model): it shows "Needs
//                 settings" and its setup waits for them
//   affectsSetup  changing it means setup has to run again (a quality
//                 tier that picks which model is downloaded). A setting a
//                 download's `when` names counts as this without saying so.
const settingExtras = {
  required: z.boolean().default(false),
  affectsSetup: z.boolean().default(false),
};

export const settingFieldSchema = z.discriminatedUnion("type", [
  textField.extend(settingExtras),
  textareaField.extend(settingExtras),
  numberField.extend(settingExtras),
  booleanField.extend(settingExtras),
  selectField.extend(settingExtras),
  z.object({ ...fieldBase, ...settingExtras, type: z.literal("secret"), default: z.literal("").default("") }),
  z.object({ ...fieldBase, ...settingExtras, type: z.literal("path"), default: z.string().max(500).default("") }),
]);

export type SettingField = z.infer<typeof settingFieldSchema>;

const contributionBase = {
  id: z.string().regex(KEY),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(""),
};

// Reads a file a DM picks and returns a workshop bundle: a new workshop is
// made from it after the DM has seen what it holds (contracts.ts).
export const workshopImporterSchema = z.object({
  ...contributionBase,
  tool: z.string().regex(TOOL),
  // File extensions (".pdf") and MIME types ("application/pdf") the picker
  // offers. At least one.
  accepts: z
    .array(z.string().trim().regex(/^(?:\.[a-z0-9]{1,10}|[a-z]+\/[a-z0-9.+-]{1,80})$/i))
    .min(1)
    .max(20),
  maxInputMB: z.number().int().min(1).max(2_048).default(256),
  options: z.array(optionFieldSchema).max(20).default([]),
});

// Builds a battle map for the map library: the ground the rules read, and
// optionally the picture under it and the data a board view draws from.
export const mapGeneratorSchema = z.object({
  ...contributionBase,
  tool: z.string().regex(TOOL),
  options: z.array(optionFieldSchema).max(20).default([]),
});

// Draws the board in place of the built-in grid, inside a sandboxed frame
// the table talks to over postMessage (src/lib/addons/board-bridge.ts).
export const boardViewSchema = z.object({
  ...contributionBase,
  // An HTML page under the package's ui/ folder.
  entry: packagePathSchema.refine((value) => value.startsWith("ui/") && /\.html?$/i.test(value), {
    message: "A board view's entry is an .html file under ui/.",
  }),
  // Offered only on maps that carry this addon's view data (a map one of its
  // generators made), rather than on every board.
  needsViewData: z.boolean().default(false),
  // A host-owned layout of native regions, never addon CSS or React code.
  sessionLayout: z.literal("stage").optional(),
  // Opaque dark surfaces keep native light text readable; accent is decorative.
  sessionTheme: z.object({
    surface: z.string().regex(/^#[0-3][0-9a-f][0-3][0-9a-f][0-3][0-9a-f]$/i),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  }).strict().optional(),
  // Choices each viewer makes for this view on their own device (a pixel
  // scale, a quality tier for a slower computer), drawn by the table and
  // handed to the view in its snapshot. The frame cannot keep anything of its
  // own: its storage is sandboxed away.
  options: z.array(optionFieldSchema).max(12).default([]),
}).refine((view) => !view.sessionLayout || !view.needsViewData, {
  message: "A session layout must work without map-specific view data.",
  path: ["needsViewData"],
}).refine((view) => !view.sessionTheme || view.sessionLayout === "stage", {
  message: "A session theme requires the stage session layout.",
  path: ["sessionTheme"],
});

export type WorkshopImporter = z.infer<typeof workshopImporterSchema>;
export type MapGenerator = z.infer<typeof mapGeneratorSchema>;
export type BoardView = z.infer<typeof boardViewSchema>;

export const CONTRIBUTION_KINDS = ["workshopImporters", "mapGenerators", "boardViews"] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export const CONTRIBUTION_LABELS: Record<ContributionKind, string> = {
  workshopImporters: "Workshop importer",
  mapGenerators: "Map generator",
  boardViews: "Board view",
};

// How the program is started. "node" runs on the server's own Node (the
// desktop app's, too), so it needs nothing installed; "python" runs on the
// Python found on this computer; "executable" is a program in the package
// built for each platform, keyed "<platform>-<arch>" ("linux-x64",
// "win32-x64", "darwin-arm64").
export const runtimeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("node"),
    entry: packagePathSchema,
    args: z.array(z.string().max(200)).max(20).default([]),
  }),
  z.object({
    kind: z.literal("python"),
    entry: packagePathSchema,
    args: z.array(z.string().max(200)).max(20).default([]),
    // The lowest Python it runs on, checked before it is started.
    minVersion: z.string().regex(/^\d+\.\d+$/).default("3.10"),
  }),
  z.object({
    kind: z.literal("executable"),
    executables: z.record(z.string().regex(/^(?:linux|win32|darwin)-(?:x64|arm64)$/), packagePathSchema).refine(
      (value) => Object.keys(value).length > 0,
      { message: "Name at least one platform's program." },
    ),
    args: z.array(z.string().max(200)).max(20).default([]),
  }),
]);

// A program the addon needs on this computer. The server looks for it before
// the addon is enabled and says what is missing, so an admin is told
// "Blender 4.2 or later" rather than shown a crash.
export const requirementSchema = z.object({
  program: z.string().regex(/^[A-Za-z0-9_.+-]{1,60}$/),
  // Other names it goes by, tried in order after `program`.
  aliases: z.array(z.string().regex(/^[A-Za-z0-9_.+-]{1,60}$/)).max(6).default([]),
  // A setting of type "path" where the admin can point at it by hand.
  setting: z.string().regex(KEY).optional(),
  versionArgs: z.array(z.string().max(60)).max(4).default(["--version"]),
  // A regular expression whose first group is the version, e.g.
  // "Blender (\\d+\\.\\d+)". Empty skips the version check.
  versionPattern: z.string().max(120).default(""),
  minVersion: z.string().regex(/^\d+(?:\.\d+){0,2}$/).optional(),
  hint: z.string().trim().max(240).default(""),
  url: z.string().url().max(300).optional(),
});

export type AddonRequirement = z.infer<typeof requirementSchema>;

// What an addon needs fetched or built before it can run, done once per
// installed version (src/lib/addons/setup.ts), with progress on the admin's
// card and a button to run it again. Everything lands in the addon's own data
// folder, which updates keep.
//
//   python     a virtual environment for a python runtime, from a
//              requirements file in the package (hash-pinned lines are
//              checked by pip)
//   downloads  files fetched over https and checked against their size and
//              SHA-256 before use (a model, a texture set, a portable
//              Blender), unpacked when asked
//   tool       one of the addon's own MCP tools, called last, for anything
//              else (baking an asset library, warming a cache)
export const PLATFORM_KEY = /^(?:linux|win32|darwin)-(?:x64|arm64)$/;

const settingValue = z.union([z.string().max(200), z.number(), z.boolean()]);

export const setupDownloadSchema = z.object({
  id: z.string().regex(KEY),
  url: z.string().url().max(500).refine((value) => value.startsWith("https://"), { message: "Downloads are https." }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "The file's SHA-256, in lowercase hex."),
  bytes: z.number().int().min(1).max(20 * 1024 * 1024 * 1024),
  // The "<platform>-<arch>" keys this download is for; absent means all.
  platforms: z.array(z.string().regex(PLATFORM_KEY)).max(6).optional(),
  unpack: z.enum(["none", "zip", "tar.gz", "tar.xz"]).default("none"),
  // Where it lands, inside the data folder.
  to: packagePathSchema,
  // Only when a setting has this value (or one of these): the large model for
  // the "high" quality tier, a language pack the admin picked.
  when: z
    .object({
      setting: z.string().regex(KEY),
      equals: z.union([settingValue, z.array(settingValue).min(1).max(20)]),
    })
    .optional(),
});

export const setupSchema = z.object({
  python: z.object({ requirements: packagePathSchema }).optional(),
  downloads: z.array(setupDownloadSchema).max(20).default([]),
  tool: z.string().regex(TOOL).optional(),
  // What it all takes on disk, for the admin to see before running it.
  diskMB: z.number().int().min(0).max(200_000).default(0),
});

export type SetupDownload = z.infer<typeof setupDownloadSchema>;

export const addonManifestSchema = z
  .object({
    $schema: z.string().optional(),
    id: addonIdSchema,
    name: z.string().trim().min(1).max(60),
    version: z.string().regex(SEMVER, "Use a version like 1.0.0."),
    apiVersion: z.number().int().min(1),
    description: z.string().trim().min(1).max(300),
    author: z.string().trim().min(1).max(80),
    homepage: z.string().url().max(300).optional(),
    license: z.string().trim().min(1).max(60),
    // The oldest server this works with, when it uses something recent.
    minServerVersion: z.string().regex(SEMVER).optional(),
    // Where it runs. Absent means everywhere the server runs.
    platforms: z.array(z.enum(["linux", "win32", "darwin"])).min(1).max(3).optional(),
    runtime: runtimeSchema,
    requires: z.array(requirementSchema).max(8).default([]),
    permissions: z.array(z.enum(ADDON_PERMISSION_IDS as [AddonPermission, ...AddonPermission[]])).max(10).default([]),
    settings: z.array(settingFieldSchema).max(30).default([]),
    setup: setupSchema.optional(),
    // Addons this one cannot run beside, and why ("Both draw the board in 3D
    // and fight over the GPU"). The server refuses to switch on one while the
    // other is on, whichever of the two says so.
    conflicts: z
      .array(z.object({ id: z.string().regex(ADDON_ID).max(ADDON_ID_MAX), reason: z.string().trim().min(1).max(200) }))
      .max(10)
      .default([]),
    // Things on this computer only one addon should use at a time ("gpu",
    // "blender"). Runs of addons naming the same one wait their turn instead
    // of running together (src/lib/addons/resources.ts).
    exclusive: z.array(z.string().regex(EXCLUSIVE_KEY, "Lowercase words joined by hyphens, like gpu.")).max(8).default([]),
    contributes: z
      .object({
        workshopImporters: z.array(workshopImporterSchema).max(10).default([]),
        mapGenerators: z.array(mapGeneratorSchema).max(10).default([]),
        boardViews: z.array(boardViewSchema).max(5).default([]),
      })
      .default({ workshopImporters: [], mapGenerators: [], boardViews: [] }),
  })
  .superRefine((manifest, context) => {
    const problems = manifestProblems(manifest);
    for (const message of problems) {
      context.addIssue({ code: "custom", message });
    }
  });

export type AddonManifest = z.infer<typeof addonManifestSchema>;

// The checks a field-by-field schema cannot make: duplicate ids, a setting a
// requirement names that does not exist, an addon that contributes nothing.
function manifestProblems(manifest: {
  id: string;
  settings: Array<{ key: string; type: string }>;
  requires: Array<{ setting?: string; program: string }>;
  runtime: { kind: string };
  setup?: { python?: unknown; downloads: Array<{ id: string; when?: { setting: string } }> };
  conflicts: Array<{ id: string }>;
  contributes: Record<ContributionKind, Array<{ id: string }>>;
}): string[] {
  const problems: string[] = [];
  const settingKeys = new Set<string>();
  for (const setting of manifest.settings) {
    if (settingKeys.has(setting.key)) problems.push(`Two settings share the key "${setting.key}".`);
    settingKeys.add(setting.key);
  }
  for (const requirement of manifest.requires) {
    const target = manifest.settings.find((setting) => setting.key === requirement.setting);
    if (requirement.setting && target?.type !== "path") {
      problems.push(`The requirement for ${requirement.program} names "${requirement.setting}", which is not a path setting.`);
    }
  }
  if (manifest.setup?.python && manifest.runtime.kind !== "python") {
    problems.push("setup.python is for an addon whose runtime is python.");
  }
  const downloadIds = new Set<string>();
  for (const download of manifest.setup?.downloads ?? []) {
    if (downloadIds.has(download.id)) problems.push(`Two setup downloads share the id "${download.id}".`);
    downloadIds.add(download.id);
    if (download.when && !settingKeys.has(download.when.setting)) {
      problems.push(`Setup download "${download.id}" depends on the setting "${download.when.setting}", which is not one of its settings.`);
    }
  }
  if (manifest.conflicts.some((conflict) => conflict.id === manifest.id)) {
    problems.push("An addon cannot conflict with itself.");
  }
  let total = 0;
  for (const kind of CONTRIBUTION_KINDS) {
    const ids = new Set<string>();
    for (const entry of manifest.contributes[kind]) {
      if (ids.has(entry.id)) problems.push(`Two ${CONTRIBUTION_LABELS[kind].toLowerCase()}s share the id "${entry.id}".`);
      ids.add(entry.id);
      total += 1;
    }
  }
  if (total === 0) problems.push("An addon has to contribute at least one importer, map generator or board view.");
  return problems;
}

// Whether a manifest can run on this server at all, with the reason when not.
// Pure, so the admin panel can say it about a registry entry before download.
export function addonFit(
  manifest: Pick<AddonManifest, "apiVersion" | "platforms" | "minServerVersion" | "runtime">,
  host: { platform: string; arch: string; serverVersion: string },
): { ok: true } | { ok: false; reason: string } {
  if (!SUPPORTED_ADDON_API_VERSIONS.includes(manifest.apiVersion)) {
    return {
      ok: false,
      reason:
        manifest.apiVersion > ADDON_API_VERSION
          ? `Written for a newer Open Dungeon Master (addon contract ${manifest.apiVersion}). Update this server first.`
          : `Written for addon contract ${manifest.apiVersion}, which this server no longer reads.`,
    };
  }
  if (manifest.platforms && !manifest.platforms.includes(host.platform as "linux" | "win32" | "darwin")) {
    return { ok: false, reason: `Runs on ${manifest.platforms.map(platformName).join(", ")} only.` };
  }
  if (manifest.runtime.kind === "executable" && !manifest.runtime.executables[`${host.platform}-${host.arch}`]) {
    return { ok: false, reason: `Ships no program for ${platformName(host.platform)} (${host.arch}).` };
  }
  if (manifest.minServerVersion && compareVersions(host.serverVersion, manifest.minServerVersion) < 0) {
    return { ok: false, reason: `Needs Open Dungeon Master ${manifest.minServerVersion} or later.` };
  }
  return { ok: true };
}

export function platformName(platform: string): string {
  return platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform;
}

// Numeric comparison of dotted versions; a pre-release tag sorts before the
// release it precedes. Enough for minServerVersion and update checks, which
// is all it is for.
export function compareVersions(a: string, b: string): number {
  const [mainA, preA = ""] = a.split("-", 2);
  const [mainB, preB = ""] = b.split("-", 2);
  const partsA = mainA.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = mainB.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : 1;
}

// The first problem in a manifest, in words an admin can act on.
export function describeManifestError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "unknown problem";
  const where = first.path.length ? `${first.path.join(".")}: ` : "";
  return `${where}${first.message}`;
}
