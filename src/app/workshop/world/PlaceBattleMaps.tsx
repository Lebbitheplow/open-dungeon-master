"use client";

import { Grid3x3, Link2, Plus, Swords, Unlink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { ContentPick } from "@/components/ui/ContentPick";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { BINDINGS_MAX, type Binding, type PlaceBindingKind } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";
import type { WorldApi } from "./useWorld";

// A place's battle maps and encounters (M4 of the WorldForge plan): on the
// place's World entry and in the card of the Atlas pin that stands for it.
// "Create battle map" makes a blank map named for the place and opens it in
// the map editor, where its walls, doors and light are drawn; "Create
// encounter" makes a fight there with its first foe, on one of the place's
// maps. "Link existing" picks one the library already has. The place keeps
// links (src/lib/worldforge/model.ts Binding), never copies, and nothing
// here makes a second place.
//
// The Atlas picture is for finding the place. A battle map's line says what
// is drawn on its ground (src/lib/db/world-bindings.ts mapGeometry), so a
// picture laid under a grid never reads as walls or light.

// Opens a battle map in the map editor, or an encounter in its form: the
// workshop's own tools, or a sheet over the table's World tab.
export type OpenPrep = (kind: PlaceBindingKind, id: string, from: string) => void;

const WORDS: Record<PlaceBindingKind, { one: string; open: string; create: string; link: string }> = {
  map: { one: "Battle map", open: "Open battle map", create: "Create battle map", link: "Link an existing battle map" },
  encounter: { one: "Encounter", open: "Open encounter", create: "Create encounter", link: "Link an existing encounter" },
};

type Row = { id: string; name: string };
type Own = { ref: string; name: string };

export function PlaceBattleMaps({
  campaignId,
  entity,
  api,
  onOpenPrep,
  compact = false,
}: {
  campaignId: string;
  entity: WorldEntity;
  api: WorldApi;
  onOpenPrep: OpenPrep;
  // In an Atlas pin's card: the same actions, under a smaller heading.
  compact?: boolean;
}) {
  const [linking, setLinking] = useState<PlaceBindingKind | null>(null);
  const [library, setLibrary] = useState<Row[] | null>(null);
  const [fighting, setFighting] = useState(false);
  const [own, setOwn] = useState<Own[]>([]);
  const [foe, setFoe] = useState<{ ref: string; name: string } | null>(null);
  const [fightMap, setFightMap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bindings = entity.entry.bindings;
  const records = entity.bound.filter((record) => record.kind === "map" || record.kind === "encounter");
  const maps = records.filter((record) => record.kind === "map" && record.found);
  const full = bindings.length >= BINDINGS_MAX;

  // The library's maps or fights, for "Link existing", read when asked.
  useEffect(() => {
    if (!linking) return;
    let cancelled = false;
    const url = linking === "map" ? `/api/campaigns/${campaignId}/dm/maps` : `/api/campaigns/${campaignId}/dm/encounter-templates`;
    fetch(url)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { maps?: Row[]; templates?: Row[] }) => {
        if (!cancelled) setLibrary((linking === "map" ? data.maps : data.templates)?.map((row) => ({ id: row.id, name: row.name })) ?? []);
      })
      .catch(() => !cancelled && setLibrary([]));
    return () => {
      cancelled = true;
    };
  }, [linking, campaignId]);

  // The table's own monsters, for an encounter's first foe.
  useEffect(() => {
    if (!fighting) return;
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/dm/bestiary`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { monsters?: Array<{ id: string; draft: { name: string } }> }) => {
        if (!cancelled) setOwn((data.monsters ?? []).map((monster) => ({ ref: `homebrew:${monster.id}`, name: monster.draft.name })));
      })
      .catch(() => !cancelled && setOwn([]));
    return () => {
      cancelled = true;
    };
  }, [fighting, campaignId]);

  // Linking is a change to the entry, with what the page opened with, so a
  // link someone else added meanwhile is not lost (as BoundRecords does).
  async function setLinks(next: Binding[]) {
    setBusy(true);
    setError("");
    const outcome = await api.update(entity.ref, { bindings: next }, { bindings });
    setBusy(false);
    if (!outcome) setError(api.error || "That link did not save.");
    else if ("conflicts" in outcome) setError("Someone else changed this place's links meanwhile. Here they are as they are now; try again.");
    return Boolean(outcome && !("conflicts" in outcome));
  }

  async function link(kind: PlaceBindingKind, id: string) {
    if (bindings.some((binding) => binding.kind === kind && binding.ref === id) || (await setLinks([...bindings, { kind, ref: id }]))) {
      setLinking(null);
      setLibrary(null);
    }
  }

  async function create(body: { make: "map" } | { make: "encounter"; monster: string; mapId?: string }) {
    setBusy(true);
    setError("");
    const made = await api.makeForPlace(entity.ref, body);
    setBusy(false);
    if (!made) {
      setError(api.error || "That could not be made.");
      return;
    }
    setFighting(false);
    setFoe(null);
    onOpenPrep(made.kind, made.id, entity.ref);
  }

  const linkedIds = new Set(bindings.map((binding) => `${binding.kind}|${binding.ref}`));
  const choices = (library ?? []).filter((row) => linking && !linkedIds.has(`${linking}|${row.id}`));

  return (
    <section className="flex flex-col gap-2" data-testid="place-battle-maps">
      <span className={cn("eyebrow text-stone-500", compact ? "text-[10px]" : "text-[10px]")}>Battle maps and encounters</span>
      {records.length ? null : (
        <p className="text-xs text-stone-400" data-testid="place-battle-maps-none">
          No battle map yet. A picture shows where {entity.name} is; a battle map holds the walls, doors and light a fight is played on.
        </p>
      )}
      {records.map((record) => {
        const drawn = record.kind !== "map" || !record.geometry || record.geometry.walls || record.geometry.lights > 0;
        return (
          <div key={`${record.kind}|${record.ref}`} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-700/60 px-2 py-1.5 text-sm" data-testid="place-battle-record" data-kind={record.kind}>
            <span className="text-[10px] uppercase tracking-[0.12em] text-stone-500">{WORDS[record.kind as PlaceBindingKind].one}</span>
            {record.found ? (
              <span className="min-w-0 text-stone-100">
                {record.name}
                {record.detail ? <span className={drawn ? "text-stone-500" : "text-amber-300"} data-testid="place-battle-detail"> · {record.detail}</span> : null}
              </span>
            ) : (
              <span className="text-amber-300">Not found at this table any more</span>
            )}
            <span className="ml-auto flex flex-wrap gap-1">
              {record.found ? (
                <KitButton tone="small" onClick={() => onOpenPrep(record.kind as PlaceBindingKind, record.ownId, entity.ref)} aria-label={`${WORDS[record.kind as PlaceBindingKind].open}: ${record.name}`}>
                  {record.kind === "map" ? <Grid3x3 className="size-3.5" /> : <Swords className="size-3.5" />} {WORDS[record.kind as PlaceBindingKind].open}
                </KitButton>
              ) : null}
              <KitButton
                tone="small"
                busy={busy}
                disabled={busy}
                onClick={() => void setLinks(bindings.filter((binding) => !(binding.kind === record.kind && binding.ref === record.ref)))}
                title="Unlink it from this place; the map or fight itself stays"
                aria-label={`Unlink ${record.name || "it"}`}
              >
                <Unlink className="size-3.5" /> Unlink
              </KitButton>
            </span>
          </div>
        );
      })}

      {linking ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-stone-700/60 p-2" data-testid="place-battle-linking">
          {library === null ? (
            <span className="text-xs text-stone-400">Reading the library...</span>
          ) : choices.length ? (
            <Select
              label={WORDS[linking].link}
              value="__none"
              placeholder={WORDS[linking].link}
              onChange={(id) => id !== "__none" && void link(linking, id)}
              options={[{ value: "__none", label: linking === "map" ? "Pick a battle map" : "Pick an encounter" }, ...choices.map((row) => ({ value: row.id, label: row.name }))]}
            />
          ) : (
            <span className="text-xs text-stone-400">{linking === "map" ? "No other battle map in the library yet." : "No other prepared encounter yet."}</span>
          )}
          <span>
            <KitButton tone="small" onClick={() => { setLinking(null); setLibrary(null); }}>
              <X className="size-3.5" /> Cancel
            </KitButton>
          </span>
        </div>
      ) : null}

      {fighting ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-stone-700/60 p-2" data-testid="place-battle-fight">
          <span className="text-xs text-stone-400">A fight at {entity.name} starts with one foe; add the rest in the encounter.</span>
          {own.length ? (
            <Select
              label="Its first foe"
              value={foe && own.some((row) => row.ref === foe.ref) ? foe.ref : "__none"}
              onChange={(ref) => setFoe(own.find((row) => row.ref === ref) ?? null)}
              options={[{ value: "__none", label: "One of your monsters" }, ...own.map((row) => ({ value: row.ref, label: row.name }))]}
            />
          ) : null}
          <ContentPick kind="monsters" label="Or one from the rulebook" placeholder="Goblin, Owlbear..." onPick={(entry) => entry.slug && setFoe({ ref: entry.slug, name: entry.name })} />
          {foe ? <span className="text-xs text-stone-300">First foe: {foe.name}</span> : null}
          {maps.length ? (
            <Select
              label="On which battle map"
              value={fightMap || maps[0].ownId}
              onChange={setFightMap}
              options={[...maps.map((record) => ({ value: record.ownId, label: record.name })), { value: "__none", label: "No battle map" }]}
            />
          ) : null}
          <span className="flex flex-wrap gap-1.5">
            <KitButton
              tone="primary"
              busy={busy}
              disabled={busy || !foe}
              onClick={() => {
                const chosen = fightMap || maps[0]?.ownId || "";
                void create({ make: "encounter", monster: foe!.ref, ...(chosen && chosen !== "__none" ? { mapId: chosen } : {}) });
              }}
            >
              Make the encounter
            </KitButton>
            <KitButton tone="small" onClick={() => { setFighting(false); setFoe(null); }}>
              <X className="size-3.5" /> Cancel
            </KitButton>
          </span>
        </div>
      ) : null}

      {!full && !linking && !fighting ? (
        <span className="flex flex-wrap gap-1.5">
          <KitButton tone="small" busy={busy} disabled={busy} onClick={() => void create({ make: "map" })} title={`A blank battle map named ${entity.name}, opened for its walls and light`}>
            <Plus className="size-3.5" /> {WORDS.map.create}
          </KitButton>
          <KitButton tone="small" onClick={() => setLinking("map")} aria-label={WORDS.map.link}>
            <Link2 className="size-3.5" /> Link existing
          </KitButton>
          <KitButton tone="small" onClick={() => setFighting(true)}>
            <Plus className="size-3.5" /> {WORDS.encounter.create}
          </KitButton>
          <KitButton tone="small" onClick={() => setLinking("encounter")} aria-label={WORDS.encounter.link}>
            <Link2 className="size-3.5" /> Link existing
          </KitButton>
        </span>
      ) : null}
      {error ? <PanelError>{error}</PanelError> : null}
    </section>
  );
}
