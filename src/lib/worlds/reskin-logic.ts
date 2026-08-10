// Display overlays for a selected world pack.
//
// Everything here changes a LABEL and nothing else. Ids are never rewritten,
// so race.asi, classFeaturesFor(klass.id), spellClassFor(klass.id) and the
// submitted sheet all keep seeing canonical values. That is the invariant that
// lets a pack be a pure reskin instead of a fork of the rules.
//
// Pure and client-safe on purpose: the character builder imports it directly
// and plain-node tests import it with no Next or database context.
import type { WorldPack } from "@/lib/worlds/types";

export type IdReskin = { id: string; name: string; blurb: string };
export type NameReskin = { from: string; name: string; blurb: string };

// What an overlaid option carries on top of its canonical shape. `packName` is
// present only when this pack actually renames the entry, which is what the
// builder keys "show the canonical name too" off.
export type Reskinned<T> = T & { packName?: string; packBlurb?: string };

export function applyIdReskins<T extends { id: string; name: string }>(
  options: T[],
  reskins: IdReskin[],
): Array<Reskinned<T>> {
  if (!reskins.length) {
    return options;
  }
  const byId = new Map(reskins.map((entry) => [entry.id, entry]));
  return options.map((option) => {
    const reskin = byId.get(option.id);
    if (!reskin) {
      return option;
    }
    // The reskin renames an option that exists. A reskin naming an id the
    // catalog does not have is ignored rather than injected, because a pack
    // must not conjure a class the rules engine cannot resolve.
    return { ...option, name: reskin.name, packName: reskin.name, packBlurb: reskin.blurb };
  });
}

// Classes additionally carry castingLabel, the existing flavor field that
// decides whether a sheet says "spells" or "Programs" or "Jutsu".
export function applyClassReskins<
  T extends { id: string; name: string; castingLabel?: string | null },
>(options: T[], pack: WorldPack | null): Array<Reskinned<T>> {
  if (!pack?.classes.length) {
    return options;
  }
  const byId = new Map(pack.classes.map((entry) => [entry.id, entry]));
  return options.map((option) => {
    const reskin = byId.get(option.id);
    if (!reskin) {
      return option;
    }
    return {
      ...option,
      name: reskin.name,
      packName: reskin.name,
      packBlurb: reskin.blurb,
      // Only override when the pack states one. A pack that leaves it null on
      // a caster is saying "the ordinary word is fine here".
      castingLabel: reskin.castingLabel ?? option.castingLabel ?? null,
    };
  });
}

export type NameReskinKind = "spells" | "items" | "features";

// The label for something the sheet stores by name. Falls through to the
// canonical string when there is no pack or no mapping, so every caller can
// pass it unconditionally.
export function displayName(
  pack: WorldPack | null,
  kind: NameReskinKind,
  canonical: string,
): string {
  if (!pack) {
    return canonical;
  }
  const wanted = canonical.trim().toLowerCase();
  const match = pack[kind].find((entry) => entry.from.trim().toLowerCase() === wanted);
  return match ? match.name : canonical;
}

export type IdReskinKind = "races" | "classes" | "backgrounds";

// Whether this pack calls out an option as fitting its world, which is what
// floats it into the builder's recommended group.
export function packRecommends(
  pack: WorldPack | null,
  kind: IdReskinKind,
  id: string,
): boolean {
  return Boolean(pack?.[kind].some((entry) => entry.id === id));
}

// The ids a pack recommends, in the pack's own order. These are raw pack
// values, NOT validated against the catalog: this module is client-safe and
// has no catalog to check against. scripts/test-world-packs.mjs proves every
// shipped pack's ids resolve, but a pack injected through WORLD_PACKS_DIR is
// unvetted, so any caller that turns this into an allowlist must filter it
// against the real catalog first (see companion-tools).
export function packIds(pack: WorldPack | null, kind: IdReskinKind): string[] {
  return pack ? pack[kind].map((entry) => entry.id) : [];
}
