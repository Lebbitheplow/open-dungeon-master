"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Dices, FileUp, Library, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { MAP_SIZE, MAP_THEMES, type MapTheme } from "@/lib/battlemap/generate";
import { skinById, skinChoices, skinFor, defaultSkinFor, type MapSkin } from "@/lib/battlemap/skins";
import { TILE_FEET, type AmbientLight } from "@/lib/battlemap/types";
import { Chip, FinePrint, PanelHead, RangeRow, mapButton, mapInput, skinSwatches } from "@/app/campaigns/[campaignId]/mapUi";
import { useCatalogue, useMapThumb, type Catalogue } from "@/app/campaigns/[campaignId]/useMapPaint";
import { ForgePreview, type ForgeMap } from "@/app/workshop/maps/ForgePreview";
import {
  AMBIENT_LABELS,
  FORGE_START,
  RESTORE_MS,
  clampSize,
  createBodyFor,
  dieSpins,
  explainRead,
  floodTotalMs,
  freshSeed,
  pushHistory,
  readHint,
  type ForgeRoll,
  type ForgeSettings,
} from "@/app/workshop/maps/forge";
import { THEME_LABELS, type LibraryState, type PreparedMap } from "@/app/workshop/maps/types";

// The Map Forge (docs/visual-overhaul-plan.md 4.1): one component for both
// places a map is rolled. In the library it names a map, rolls it, shows it
// drawing itself in, and keeps it; blank maps, imports and "keep the board"
// sit beside the roll as they always did. In the studio the same controls roll
// a private preview and the caller supplies what can be done with it.
//
// What is previewed is what is saved: the library's preview runs the very
// generator the server creates the map with, from the same seed and the same
// words (forge.ts, held to it by scripts/test-map-forge.mjs). The studio's
// preview comes from the server, which knows how many are at the table.

type Entry = { roll: ForgeRoll; map: ForgeMap };

function ThemeSwatch({ theme, genre, catalogue }: { theme: MapTheme; genre: string | null | undefined; catalogue: Catalogue | null }) {
  const pictures = useMemo(() => skinSwatches(skinFor(genre, theme), catalogue), [genre, theme, catalogue]);
  // Floor, wall, water, rough: the four that say what kind of place it is.
  return (
    <span aria-hidden="true" className="grid size-7 grid-cols-2 overflow-hidden rounded-[5px] border border-black/50">
      {[".", "#", "~", ","].map((char) => (
        <span key={char} className="bg-stone-800 bg-cover" style={pictures[char] ? { backgroundImage: `url("${pictures[char]}")` } : undefined} />
      ))}
    </span>
  );
}

function HistoryTile({
  entry,
  genre,
  skin,
  active,
  onRestore,
}: {
  entry: Entry;
  genre: string | null | undefined;
  skin: MapSkin | null;
  active: boolean;
  onRestore: () => void;
}) {
  const thumb = useMapThumb({
    width: entry.map.width,
    height: entry.map.height,
    terrain: entry.map.terrain,
    theme: entry.map.theme,
    genre,
    skin,
    seedKey: `forge:${entry.roll.seed}`,
  });
  return (
    <button
      type="button"
      onClick={onRestore}
      aria-pressed={active}
      title={`Seed ${entry.roll.seed}: ${entry.map.width} by ${entry.map.height}, ${THEME_LABELS[entry.map.theme]}`}
      className={cn(
        "map-seed-roll w-[76px] shrink-0 overflow-hidden rounded-md border text-left motion-press",
        active ? "border-amber-400/80" : "border-stone-700 hover:border-stone-500",
      )}
    >
      <span
        aria-hidden="true"
        className="block w-full bg-stone-900 bg-cover"
        style={{ aspectRatio: `${entry.map.width} / ${entry.map.height}`, backgroundImage: thumb ? `url("${thumb}")` : undefined }}
      />
      <span className="block truncate px-1 py-0.5 font-mono text-[8px] text-stone-400">{entry.roll.seed}</span>
    </button>
  );
}

function FactChip({ name, children, claim }: { name: string; children: ReactNode; claim?: string | number }) {
  return (
    // Keyed by its value so the chip claims afresh when the value changes.
    <span key={claim} className="map-chip-claim flex items-baseline gap-1.5 rounded-md border border-stone-700/80 bg-stone-950/60 px-2 py-1">
      <span className="font-display text-[8px] uppercase tracking-[0.16em] text-stone-500">{name}</span>
      <span className="font-mono text-[10px] text-amber-100">{children}</span>
    </span>
  );
}

export function MapForge({
  surface,
  genre,
  busy,
  board = null,
  showHeading = true,
  onCreate,
  onImport,
  generate,
  actions,
  size,
}: {
  surface: "library" | "studio";
  genre: string | null | undefined;
  busy: boolean;
  board?: LibraryState["board"];
  showHeading?: boolean;
  // Library: make a map. Resolves with it so the name clears only when
  // something was actually made.
  onCreate?: (body: Record<string, unknown>) => Promise<{ map?: PreparedMap } | null>;
  onImport?: (file: File) => void;
  // Where a roll's map comes from. The library generates it here; the studio
  // asks the server, which may refuse.
  generate: (roll: ForgeRoll) => Promise<ForgeMap | null> | ForgeMap | null;
  // Studio: what can be done with the roll on show (null when there is none).
  actions?: (roll: ForgeRoll | null, clear: () => void) => ReactNode;
  // Studio: the live board's size, offered as the starting size.
  size?: { width: number; height: number };
}) {
  const library = surface === "library";
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<ForgeSettings>({ ...FORGE_START, ...(size ?? {}) });
  const [sizedFor, setSizedFor] = useState(size);
  if (size && (sizedFor?.width !== size.width || sizedFor?.height !== size.height)) {
    // The board changed size under the studio: follow it, as the old panel did.
    setSizedFor(size);
    setSettings((current) => ({ ...current, ...size }));
  }
  const [skin, setSkin] = useState<MapSkin>({ id: "", bind: {} });
  const [shown, setShown] = useState<(Entry & { rollId: number; stretch: number }) | null>(null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [rolling, setRolling] = useState(false);
  const rollCount = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const catalogue = useCatalogue();

  const named = name.trim().length > 0;
  const canRoll = !busy && !rolling && (!library || named);
  const read = useMemo(() => readHint(settings.hint, genre), [settings.hint, genre]);
  const theme = settings.theme || read.theme;
  const ambient = settings.ambient || read.ambient;
  const sentences = explainRead(read, settings, (value) => THEME_LABELS[value]);
  const skinGroups = useMemo(() => skinChoices(genre), [genre]);

  async function show(roll: ForgeRoll, stretch: number) {
    setRolling(true);
    try {
      const map = await generate(roll);
      if (!map) {
        return;
      }
      rollCount.current += 1;
      setShown({ roll, map, rollId: rollCount.current, stretch });
      // Stacked on a phone, the preview is below the controls: bring the roll
      // to the person rather than leave it drawing itself in off screen.
      previewRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setHistory((current) => {
        const rolls = pushHistory(
          current.map((entry) => entry.roll),
          roll,
        );
        const byRoll = new Map<ForgeRoll, Entry>([[roll, { roll, map }], ...current.map((entry) => [entry.roll, entry] as const)]);
        return rolls.flatMap((kept) => byRoll.get(kept) ?? []);
      });
    } finally {
      setRolling(false);
    }
  }

  const rollOne = () => show({ ...settings, ...clampSize(settings.width, settings.height), seed: freshSeed() }, 1);
  function restore(entry: Entry) {
    setSettings({ width: entry.roll.width, height: entry.roll.height, theme: entry.roll.theme, ambient: entry.roll.ambient, hint: entry.roll.hint });
    void show(entry.roll, Math.max(1, RESTORE_MS / floodTotalMs(entry.roll.width, entry.roll.height)));
  }

  async function create(body: Record<string, unknown>) {
    const result = await onCreate?.({ name: name.trim(), ...body });
    if (result?.map) {
      setName("");
      setShown(null);
    }
  }

  const setSide = (side: "width" | "height", value: number) => setSettings((current) => ({ ...current, [side]: value || current[side] }));
  const sizeNow = clampSize(settings.width, settings.height);

  return (
    // Buttons and fields take their type from here: the app resets `font` on
    // them outside any layer, so a size utility on the element itself loses.
    <section className="@container text-[13px]" data-tour="maps-create">
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        {/* Controls */}
        <div className="panel space-y-3 rounded-xl p-4">
          {showHeading ? (
            <p className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-[0.2em] text-amber-400/90">
              <Library className="size-3.5" />
              {library ? "The map drawer" : "Roll the board"}
            </p>
          ) : null}
          {library ? (
            <label className="block space-y-1">
              <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">Name it</span>
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name it: the flooded crypt"
                className={cn(mapInput, "py-2 text-sm")}
              />
            </label>
          ) : null}
          <label className="block space-y-1">
            <span className="flex items-baseline justify-between">
              <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">What the place is like</span>
              <span className="font-mono text-[9px] text-stone-600">steers the generator</span>
            </span>
            <input
              value={settings.hint}
              maxLength={200}
              onChange={(event) => setSettings({ ...settings, hint: event.target.value })}
              placeholder={library ? "what the place is like, for the generator" : "a flooded crypt, torchlit"}
              className={cn(mapInput, "map-read py-2 text-sm", read.themeWord && "border-amber-500/55")}
            />
          </label>

          {/* What it read */}
          <div
            className={cn(
              "map-read space-y-1.5 rounded-lg border p-2.5",
              read.themeWord ? "border-amber-500/35 bg-amber-400/[0.06]" : "border-stone-700/60 bg-stone-950/40",
            )}
          >
            <p className="font-display text-[9px] uppercase tracking-[0.18em] text-amber-400/80">What it read</p>
            {read.words.length ? (
              <p className="flex flex-wrap gap-x-1 gap-y-0.5 font-mono text-[11px] text-stone-500">
                {read.words.map((word, index) => (
                  <span
                    key={`${index}-${word.text}-${word.hit ?? ""}`}
                    className={cn("rounded px-1", word.hit && "map-word-hit bg-amber-400/15 text-amber-100")}
                    // The words light in the order they are read.
                    style={word.hit ? { animationDelay: `${index * 40}ms` } : undefined}
                  >
                    {word.text}
                  </span>
                ))}
              </p>
            ) : (
              <FinePrint>Say anything about the place and the words it recognises light up here.</FinePrint>
            )}
            <div className="flex flex-wrap gap-1.5">
              <FactChip name="Theme" claim={theme}>
                {THEME_LABELS[theme]}
              </FactChip>
              <FactChip name="Light" claim={ambient}>
                {AMBIENT_LABELS[ambient].toLowerCase()}
              </FactChip>
            </div>
            <p className="text-[11px] leading-snug text-stone-300">{sentences.join(" ")}</p>
          </div>

          <div className="space-y-1.5">
            <p className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">Or say outright</p>
            <div data-pill-group="" className="grid grid-cols-3 gap-1.5">
              {MAP_THEMES.map((option) => (
                <button data-on={settings.theme === option ? "" : undefined}
                  key={option}
                  type="button"
                  aria-pressed={settings.theme === option}
                  title={settings.theme === option ? "Press again to go back to the words" : `Always ${THEME_LABELS[option].toLowerCase()}, whatever the words say`}
                  onClick={() => setSettings({ ...settings, theme: settings.theme === option ? "" : option })}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 motion-press",
                    settings.theme === option
                      ? "border-amber-500/60 bg-amber-400/10 text-amber-100"
                      : "border-stone-800 bg-stone-950/40 text-stone-300 hover:border-stone-600",
                  )}
                >
                  <ThemeSwatch theme={option} genre={genre} catalogue={catalogue} />
                  <span className="text-[11px]">{THEME_LABELS[option]}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1">
              <Chip active={settings.ambient === ""} onClick={() => setSettings({ ...settings, ambient: "" })} title="Light from the words">
                Words
              </Chip>
              {(["bright", "dim", "dark"] as AmbientLight[]).map((option) => (
                <Chip key={option} active={settings.ambient === option} onClick={() => setSettings({ ...settings, ambient: option })}>
                  {AMBIENT_LABELS[option]}
                </Chip>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="flex items-baseline justify-between font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">
              Size
              <span className="font-mono normal-case tracking-normal text-stone-400">
                {sizeNow.width * TILE_FEET} × {sizeNow.height * TILE_FEET} ft
              </span>
            </p>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                {(
                  [
                    ["width", "Across", MAP_SIZE.minWidth, MAP_SIZE.maxWidth],
                    ["height", "Down", MAP_SIZE.minHeight, MAP_SIZE.maxHeight],
                  ] as const
                ).map(([side, label, min, max]) => (
                  <div key={side} className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <RangeRow label={label} min={min} max={max} value={sizeNow[side]} onChange={(value) => setSide(side, value)} />
                    </div>
                    {/* A phone slider cannot land on 17; the number can be typed. */}
                    <span className="shrink-0" onBlur={() => setSettings((current) => ({ ...current, ...clampSize(current.width, current.height) }))}>
                      <NumberStepper min={min} max={max} value={settings[side]} label={`${label}, in squares`} onChange={(value) => setSide(side, value)} size="sm" />
                    </span>
                  </div>
                ))}
              </div>
              <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed border-stone-700">
                <span
                  className="rounded-[2px] border border-amber-500/60 bg-amber-400/10 transition-[width,height] duration-[260ms]"
                  style={{ width: `${(sizeNow.width / MAP_SIZE.maxWidth) * 36}px`, height: `${(sizeNow.height / MAP_SIZE.maxWidth) * 36}px` }}
                />
              </span>
            </div>
          </div>

          {library ? (
            <label className="block space-y-1">
              <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">Painted as</span>
              <Select<string>
                value={skin.id}
                label="Skin"
                size="sm"
                onChange={(id) => setSkin({ id, bind: {} })}
                className="w-full"
                options={[
                  { value: "", label: `Default: ${skinById(defaultSkinFor(genre, theme))?.name ?? "Stone dungeon"}` },
                  ...skinGroups.flatMap((group) => group.skins.map((option) => ({ value: option.id as string, label: option.name, group: group.group }))),
                ]}
              />
            </label>
          ) : null}

          <div className="flex flex-wrap items-stretch gap-1.5 text-[12px]">
            <button
              type="button"
              disabled={!canRoll}
              onClick={() => void rollOne()}
              className="flex h-11 min-w-36 flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-4 text-amber-950 shadow-[0_1px_0_rgba(253,247,231,0.6)_inset,0_2px_8px_rgba(4,2,12,0.5)] disabled:cursor-not-allowed disabled:opacity-50 motion-magnet"
            >
              <Dices
                key={shown?.rollId ?? 0}
                className={cn("size-4", rolling || busy ? "map-die-spin" : shown && "map-die-roll")}
                style={shown ? ({ "--map-spins": dieSpins(shown.map.width, shown.map.height, shown.stretch) } as CSSProperties) : undefined}
              />
              <span className="whitespace-nowrap font-display text-[13px] font-semibold uppercase tracking-[0.14em]">
                {shown ? "Roll another" : library ? "Roll one" : "Roll a map"}
              </span>
            </button>
            {library
              ? (["rock", "ground"] as const).map((blank) => (
                  <button
                    key={blank}
                    type="button"
                    disabled={busy || !named}
                    title={blank === "rock" ? "Solid rock to carve rooms out of" : "Open ground to put things on"}
                    onClick={() => void create({ do: "create", ...sizeNow, blank })}
                    className={cn(mapButton, "h-11")}
                  >
                    {blank === "rock" ? "Blank rock" : "Blank ground"}
                  </button>
                ))
              : null}
          </div>
          {library ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <input
                ref={fileRef}
                type="file"
                accept=".dd2vtt,.uvtt,.df2vtt,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onImport?.(file);
                  }
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={busy}
                title="A Universal VTT export from Dungeondraft and its neighbours, or a One Page Dungeon JSON"
                onClick={() => fileRef.current?.click()}
                className={mapButton}
              >
                <FileUp className="size-3" /> Import .dd2vtt
              </button>
              {board ? (
                <button
                  type="button"
                  disabled={busy || !named}
                  title="Save the map that is on the table right now"
                  onClick={() => void create({ do: "capture" })}
                  className={mapButton}
                >
                  <Save className="size-3" /> Keep the board
                </button>
              ) : null}
            </div>
          ) : null}
          <FinePrint>
            {library
              ? named
                ? "Nothing here touches the table until you put it there."
                : "Name it first. Nothing here touches the table until you put it there."
              : "The generator reads the words for terrain and light. What you say outright overrules them."}
          </FinePrint>
        </div>

        {/* Preview */}
        <div ref={previewRef} className="panel min-w-0 scroll-mt-4 space-y-3 rounded-xl p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="min-w-0 truncate font-display text-[15px] uppercase tracking-[0.08em] text-amber-100">
              {library ? name.trim() || "An unnamed place" : "The preview"}
            </h3>
            <span className="shrink-0 font-mono text-[10px] text-stone-400">
              {shown ? `${shown.map.width} × ${shown.map.height} · ${THEME_LABELS[shown.map.theme]}` : `${sizeNow.width} × ${sizeNow.height}`}
            </span>
          </div>
          {shown ? (
            <ForgePreview
              map={shown.map}
              genre={genre}
              skin={library ? skin : null}
              seedKey={`forge:${shown.roll.seed}`}
              rollId={shown.rollId}
              stretch={shown.stretch}
            />
          ) : (
            <div
              className="map-well flex w-full items-center justify-center rounded-lg border border-dashed border-stone-700 p-6 text-center"
              style={{ aspectRatio: `${sizeNow.width} / ${sizeNow.height}` }}
            >
              <p className="max-w-xs font-serif text-[13px] italic text-stone-500">
                {library && !named ? "Name the place, then roll it. It draws itself in here." : "Roll, and the place draws itself in here."}
              </p>
            </div>
          )}
          {shown ? (
            <div className="flex flex-wrap gap-1.5">
              <FactChip name="Seed" claim={shown.roll.seed}>
                {shown.roll.seed}
              </FactChip>
              <FactChip name="Theme">{THEME_LABELS[shown.map.theme]}</FactChip>
              <FactChip name="Light">{AMBIENT_LABELS[shown.map.ambient].toLowerCase()}</FactChip>
              <FactChip name="Torches">{shown.map.lights.length}</FactChip>
              {shown.map.pcSpawns ? (
                <FactChip name="Spawns">
                  {shown.map.pcSpawns.length} party · {shown.map.enemySpawns?.length ?? 0} foes
                </FactChip>
              ) : null}
            </div>
          ) : null}
          {library && shown ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || !named}
                onClick={() => void create({ ...createBodyFor(shown.roll), ...(skin.id ? { skin } : {}) })}
                className="flex h-10 items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-400/10 px-4 text-amber-100 hover:bg-amber-400/15 disabled:opacity-50 motion-press"
              >
                <Save className="size-3.5" /> <span className="font-display text-[12px] uppercase tracking-[0.14em]">Keep it</span>
              </button>
              <FinePrint>Saves this very map, from its seed, into the drawer and opens it.</FinePrint>
            </div>
          ) : null}
          {actions ? actions(shown?.roll ?? null, () => setShown(null)) : null}

          <div className="space-y-1.5">
            <PanelHead aside={history.length ? `${history.length} kept · tap to bring back` : "seeds are cheap"}>This session&apos;s rolls</PanelHead>
            {history.length ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {history.map((entry) => (
                  <HistoryTile
                    key={`${entry.roll.seed}-${entry.roll.width}x${entry.roll.height}-${entry.roll.theme}-${entry.roll.ambient}-${entry.roll.hint}`}
                    entry={entry}
                    genre={genre}
                    skin={library ? skin : null}
                    active={shown?.roll === entry.roll}
                    onRestore={() => restore(entry)}
                  />
                ))}
              </div>
            ) : (
              <p className="font-serif text-[12px] italic leading-snug text-stone-500">
                Roll a few and they stack up here. Tap one to bring it back: the seed is all it takes, so nothing you liked
                is ever a re-roll away from being lost.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
