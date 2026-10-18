import type { ArtStyle, StorySettings } from "@/lib/types";

// How a campaign's generated maps and scene pictures look (issue 377).
//
// By default the setting decides: the genre's or world pack's mapStyle and
// sceneStyle (src/lib/genres.ts, src/lib/worlds/preset.ts). A campaign can
// pick one of a few presets instead, each a matched pair for maps and
// scenes, or write its own. Portraits, covers and battle maps keep their own
// looks.

export const ART_STYLE_LABELS: Record<ArtStyle, string> = {
  setting: "From the setting",
  painted: "Painted",
  ink: "Ink and parchment",
  realistic: "Realistic",
  comic: "Comic book",
  custom: "Custom",
};

// One line under the picker, so the choice says what it asks for.
export const ART_STYLE_NOTES: Record<ArtStyle, string> = {
  setting: "The look the campaign's setting or world pack gives its maps and scenes.",
  painted: "Painted maps in rich color; scenes as painterly illustrations.",
  ink: "Ink and watercolor on aged parchment, for maps and scenes alike.",
  realistic: "Realistic terrain maps with no parchment; scenes as photographic stills.",
  comic: "Bold ink lines and flat color, for maps and scenes alike.",
  custom: "Your own words for each. A blank one keeps the setting's look.",
};

type PresetStyle = Exclude<ArtStyle, "setting" | "custom">;

export const ART_STYLE_PRESETS: Record<PresetStyle, { map: string; scene: string }> = {
  painted: {
    map: "hand-painted map, rich gouache color, soft brush texture",
    scene: "painterly digital illustration, visible brushwork, rich color, dramatic light",
  },
  ink: {
    map: "hand-drawn ink cartography on aged parchment, watercolor washes",
    scene: "pen and ink illustration with watercolor washes on aged paper",
  },
  realistic: {
    map: "realistic terrain seen from directly above, natural colors and textures, no parchment",
    scene: "photorealistic cinematic still, natural light, shallow depth of field",
  },
  comic: {
    map: "bold inked comic-book map, flat colors, thick outlines",
    scene: "comic book illustration, bold ink lines, flat cel shading",
  },
};

export type ArtSettings = Pick<StorySettings, "artStyle" | "artStyleMap" | "artStyleScene">;
export type SettingLook = { mapStyle: string; sceneStyle: string };

// The words each kind of picture is drawn in, for this campaign now.
export function artDirection(settings: ArtSettings, look: SettingLook): { map: string; scene: string } {
  if (settings.artStyle === "custom") {
    return {
      map: settings.artStyleMap.trim() || look.mapStyle,
      scene: settings.artStyleScene.trim() || look.sceneStyle,
    };
  }
  if (settings.artStyle === "setting") {
    return { map: look.mapStyle, scene: look.sceneStyle };
  }
  return ART_STYLE_PRESETS[settings.artStyle] ?? { map: look.mapStyle, scene: look.sceneStyle };
}

// Words the person typed, which a table that plays in another language
// needs rewritten in English before an image model reads them. The presets
// and the settings' own styles are English already.
export function typedStyle(settings: ArtSettings, kind: "map" | "scene"): string {
  if (settings.artStyle !== "custom") {
    return "";
  }
  return (kind === "map" ? settings.artStyleMap : settings.artStyleScene).trim();
}

// Image models paint lettering badly, and the prompt never said what the
// labels should read, so a map came back with invented or garbled names.
// The map panel shows the place's name as text already, so the picture
// carries none. This asks, it cannot guarantee: a model may still letter.
export const MAP_NEGATIVE = "letters, words, labels, captions, legend, numbers";

export function locationMapPrompt(style: string, place: { name: string; layout: string }): string {
  return ["top-down game map", style, "clear pathways", "no text or lettering", place.name, place.layout]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

// The campaign's style leads: models weigh the first words most, and a CLIP
// encoder cuts a long prompt off at the end, never at the start. The DM
// writes the subject and is told to leave the style out (src/lib/image-tool.ts).
export function scenePrompt(style: string, prompt: string): string {
  const look = style.trim();
  return look ? `${look}. ${prompt.trim()}` : prompt.trim();
}
