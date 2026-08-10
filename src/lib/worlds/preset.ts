// The genre preset a campaign actually runs on.
//
// Every consumer that used to call genrePreset(genre) calls presetFor(settings)
// instead, so a selected world pack reaches the DM prompt, story setup, arc
// planning, maps, portraits and companions without any of them having to learn
// what a pack is. A campaign with no pack, or with a pack id that no longer
// exists on disk, gets exactly the plain genre preset back.
import { genrePreset, type GenrePreset } from "@/lib/genres";
import { worldPack } from "@/lib/worlds";
import type { WorldPack } from "@/lib/worlds/types";

// Structurally satisfied by GameSettings, so callers pass campaign.gameSettings
// straight in. `worldPack` is optional for the few call sites (portraits) that
// carry a genre on a record older than the field.
export type SettingRef = { genre: string; worldPack?: string };

export function packFor(setting: SettingRef): WorldPack | null {
  return worldPack(setting.worldPack ?? "");
}

export function presetFor(setting: SettingRef): GenrePreset {
  const base = genrePreset(setting.genre);
  const pack = packFor(setting);
  if (!pack) {
    return base;
  }
  return {
    ...base,
    name: pack.name,
    blurb: pack.blurb,
    // The pack's flavor is APPENDED rather than substituted, so the genre's
    // own standing instruction survives. That matters most for the reskin
    // genres, whose flavor ends with "keep all 5e mechanics unchanged, only
    // the skin differs" - exactly the rule a pack most needs enforced.
    dmFlavor: base.dmFlavor && pack.dmFlavor
      ? `${base.dmFlavor}\n\n${pack.dmFlavor}`
      : pack.dmFlavor || base.dmFlavor,
    mapStyle: pack.mapStyle || base.mapStyle,
    portraitStyle: pack.portraitStyle || base.portraitStyle,
    nameHints: pack.nameHints || base.nameHints,
    raceHint: pack.raceHint || base.raceHint,
    companionRaces: pack.companionRaces.length ? pack.companionRaces : base.companionRaces,
    defaultTheme: pack.theme || base.defaultTheme,
  };
}

// Story elements the setup and arc passes lean on: the world's own factions,
// places and hooks, as a compact block or an empty string when there is no
// pack. Kept here rather than in each caller so the three passes agree.
export function packWorldHints(setting: SettingRef): string {
  const pack = packFor(setting);
  if (!pack) {
    return "";
  }
  const lines: string[] = [];
  if (pack.factions.length) {
    lines.push(
      `Factions of this world: ${pack.factions.map((entry) => `${entry.name} (${entry.blurb})`).join("; ")}`,
    );
  }
  if (pack.locations.length) {
    lines.push(
      `Places of this world: ${pack.locations.map((entry) => `${entry.name} (${entry.blurb})`).join("; ")}`,
    );
  }
  if (pack.hooks.length) {
    lines.push(`Story hooks that fit this world: ${pack.hooks.join(" | ")}`);
  }
  return lines.join("\n");
}
