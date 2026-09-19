"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import {
  SKIN_CHARS,
  SKIN_ROLES,
  defaultSkinFor,
  skinById,
  skinChoices,
  type MapSkin,
  type Skin,
  type SkinChar,
} from "@/lib/battlemap/skins";
import type { TileEntry } from "@/lib/battlemap/render/painted";
import { materialChoices } from "@/app/campaigns/[campaignId]/mapCatalogue";
import type { Catalogue } from "@/app/campaigns/[campaignId]/useMapPaint";
import { Chip, FinePrint, PanelHead, Swatch, mapInput } from "@/app/campaigns/[campaignId]/mapUi";

// The tileset panel (docs/visual-overhaul-plan.md 4.4): which skin the map
// wears and, under it, the material each of the six terrain characters is
// painted with. The skin defaults to what the campaign's setting and the
// map's theme give; naming another, or swapping one material, is stored on
// the map. The terrain string never changes: a crystal wall and a hedge are
// both "#". Painted or Flat is this device's choice and no part of the map.

export function MapTilesetPanel({
  skin,
  resolved,
  genre,
  theme,
  catalogue,
  counts,
  painted,
  onPainted,
  onSkin,
}: {
  // What the map stores; empty means the default.
  skin: MapSkin;
  // What it is painted with after the default and the overrides are applied.
  resolved: Skin;
  genre: string | null | undefined;
  theme: string;
  catalogue: Catalogue | null;
  // How many tiles of each terrain character the map has.
  counts: Record<string, number>;
  painted: boolean;
  onPainted: (on: boolean) => void;
  // Absent on a surface that cannot store a skin (the live board).
  onSkin?: (next: MapSkin) => void;
}) {
  const [picking, setPicking] = useState<SkinChar | null>(null);
  const tiles = useMemo(() => new Map((catalogue?.tiles ?? []).map((tile) => [tile.id, tile])), [catalogue]);
  const defaultId = defaultSkinFor(genre, theme);
  const groups = useMemo(() => skinChoices(genre), [genre]);
  const overridden = Object.keys(skin.bind).length > 0;

  return (
    <section className="space-y-1.5">
      <PanelHead aside={painted ? "painted" : "flat fills"}>Tileset</PanelHead>
      <div className="grid grid-cols-2 gap-1">
        <Chip active={!painted} onClick={() => onPainted(false)} title="The old flat diagram. A choice for this device, not the map.">
          Flat
        </Chip>
        <Chip active={painted} onClick={() => onPainted(true)} title="Painted by the renderer the table plays on.">
          Painted
        </Chip>
      </div>

      {onSkin ? (
        <label className="block space-y-1">
          <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">Skin</span>
          <Select
            value={skin.id as string}
            label="Skin"
            size="sm"
            onChange={(id) => onSkin({ id, bind: {} })}
            options={[
              { value: "", label: `Default: ${skinById(defaultId)?.name ?? "Stone dungeon"}` },
              ...groups.flatMap((group) => group.skins.map((option) => ({ value: option.id as string, label: option.name, group: group.group }))),
            ]}
            className="w-full"
          />
        </label>
      ) : (
        <p className="text-[11px] text-stone-300">{resolved.name}</p>
      )}
      <FinePrint>{resolved.note}</FinePrint>

      <ul className="space-y-0.5">
        {SKIN_CHARS.map((char) => {
          const material = tiles.get(resolved.bind[char]);
          const own = Boolean(skin.bind[char]);
          return (
            <li key={char}>
              <button
                type="button"
                disabled={!onSkin || !catalogue}
                onClick={() => setPicking(char)}
                title={onSkin ? `Choose what ${SKIN_ROLES[char].label.toLowerCase()} is painted with` : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-1.5 py-1 text-left motion-press disabled:cursor-default",
                  own ? "border-amber-500/40 bg-amber-400/5" : "border-transparent hover:border-stone-700",
                )}
              >
                <Swatch char={char} src={painted ? material?.src : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-stone-200">{SKIN_ROLES[char].label}</span>
                  <span className="block truncate font-mono text-[9px] text-stone-500">
                    {material?.label ?? resolved.bind[char]}
                    {own ? " · yours" : ""}
                  </span>
                </span>
                <span className="font-mono text-[9px] tabular-nums text-amber-200/80">{counts[char] ?? 0}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {onSkin && overridden ? (
        <button
          type="button"
          onClick={() => onSkin({ id: skin.id, bind: {} })}
          className="flex min-h-8 items-center gap-1 text-[11px] text-stone-400 hover:text-amber-200"
        >
          <RotateCcw className="size-3" /> Back to the skin&apos;s own materials
        </button>
      ) : null}

      {onSkin && catalogue ? (
        <MaterialPicker
          char={picking}
          tiles={catalogue.tiles}
          genre={genre}
          theme={theme}
          current={picking ? resolved.bind[picking] : ""}
          skinsOwn={picking ? ((skinById(skin.id || defaultId)?.bind[picking] as string | undefined) ?? "") : ""}
          onClose={() => setPicking(null)}
          onPick={(material) => {
            if (!picking) {
              return;
            }
            const bind = { ...skin.bind };
            const base = skinById(skin.id || defaultId)?.bind[picking];
            // Choosing the skin's own material is the same as having no override.
            if (material === base) {
              delete bind[picking];
            } else {
              bind[picking] = material;
            }
            onSkin({ id: skin.id, bind });
            setPicking(null);
          }}
        />
      ) : null}
    </section>
  );
}

// The catalogue, narrowed to what can paint one terrain character: this
// setting's materials first, those suited to the map's theme ahead of the
// rest, each shown as the 3 by 3 repeat it will actually tile as.
function MaterialPicker({
  char,
  tiles,
  genre,
  theme,
  current,
  skinsOwn,
  onPick,
  onClose,
}: {
  char: SkinChar | null;
  tiles: TileEntry[];
  genre: string | null | undefined;
  theme: string;
  current: string;
  skinsOwn: string;
  onPick: (material: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => (char ? materialChoices(tiles, char, genre, theme, query) : []), [tiles, char, genre, theme, query]);
  return (
    <Dialog
      open={char !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={char ? `${SKIN_ROLES[char].label}: painted with` : "Material"}
      width="w-[min(94vw,44rem)]"
    >
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a material: granite, moss, lava"
        aria-label="Find a material"
        className={cn(mapInput, "mb-3")}
      />
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.group} className="space-y-1.5">
            <PanelHead aside={String(group.tiles.length)}>{group.group}</PanelHead>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {group.tiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  aria-pressed={tile.id === current}
                  onClick={() => onPick(tile.id)}
                  className={cn(
                    "overflow-hidden rounded-lg border text-left motion-press",
                    tile.id === current ? "border-amber-400/80 shadow-glow-gold" : "border-stone-700 hover:border-stone-500",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="block aspect-square w-full bg-stone-900"
                    // A door is one object, not a surface: shown once, not tiled.
                    style={
                      char === "+"
                        ? { backgroundImage: `url("${tile.src}")`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }
                        : { backgroundImage: `url("${tile.src}")`, backgroundSize: "33.34% 33.34%" }
                    }
                  />
                  <span className="block truncate px-1.5 py-1 text-[10px] text-stone-200">
                    {tile.label ?? tile.id}
                    {tile.id === skinsOwn ? <span className="ml-1 text-amber-400/80">skin</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!groups.length ? <FinePrint>Nothing in the tile set matches that.</FinePrint> : null}
      </div>
    </Dialog>
  );
}
