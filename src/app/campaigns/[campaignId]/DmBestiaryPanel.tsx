"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Search, Skull, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  MONSTER_NAME_MAX,
  type MonsterDraft,
  type MonsterReadout,
} from "@/lib/bestiary/monster-draft";
import { crLabel } from "@/lib/bestiary/derive-cr";
import {
  AttackEditor,
  NumberField,
  RatingLine,
  SaveEditor,
  SizeAndDefences,
  TraitEditor,
  Working,
} from "@/app/campaigns/[campaignId]/MonsterFields";
import { MonsterKitPanel } from "@/app/campaigns/[campaignId]/MonsterKitFields";

// The bestiary forge: build a monster, and see what it is actually worth.
//
// The whole point of the panel is the number in the corner. A hand-built
// monster with a challenge rating somebody typed is a monster the encounter
// budget cannot cost, so this derives the rating from the block
// (src/lib/bestiary/derive-cr.ts) and shows the working beside it.
//
// A monster saved here answers to its name everywhere the engine resolves
// one, so a prepared encounter can put it on the board through the ordinary
// start_encounter path.

type Monster = {
  id: string;
  slug: string;
  draft: MonsterDraft;
  desc: string;
  readout: MonsterReadout;
  summary: string;
};

type Found = { slug: string; name: string; source: string; cr: number };

const CR_CHOICES = [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 17, 20, 24, 30];

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

export function DmBestiaryPanel({ campaignId }: { campaignId: string }) {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [found, setFound] = useState<Found[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MonsterDraft | null>(null);
  const [desc, setDesc] = useState("");
  const [readout, setReadout] = useState<MonsterReadout | null>(null);
  const [newName, setNewName] = useState("");
  const [newCr, setNewCr] = useState(1);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    (search?: string) =>
      fetch(
        `/api/campaigns/${campaignId}/dm/bestiary${
          search ? `?q=${encodeURIComponent(search)}` : ""
        }`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { monsters: Monster[]; found: Found[] } | null) => {
          if (payload) {
            setMonsters(payload.monsters);
            setFound(payload.found);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        }),
    [campaignId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function open(monster: Monster) {
    setOpenId(monster.id);
    setDraft(monster.draft);
    setDesc(monster.desc);
    setReadout(monster.readout);
    setError("");
  }

  async function create(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/bestiary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        monster?: Monster;
        error?: string;
      };
      if (!response.ok || !payload.monster) {
        setError(payload.error ?? "That could not be built.");
        return;
      }
      setNewName("");
      await load(query || undefined);
      open(payload.monster);
    } finally {
      setBusy(false);
    }
  }

  // The whole block goes at once. A stat block is one thing a person is
  // looking at, and half-saving it is how an armour class and a rating end
  // up describing different monsters.
  async function save() {
    if (!draft || !openId) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/bestiary/${openId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: { name: draft.name, ...draft.stats, extraDamagePerRound: draft.extraDamagePerRound },
          desc,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        monster?: Monster;
        error?: string;
      };
      if (!response.ok || !payload.monster) {
        setError(payload.error ?? "That could not be saved.");
        return;
      }
      setReadout(payload.monster.readout);
      setDraft(payload.monster.draft);
      await load(query || undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/campaigns/${campaignId}/dm/bestiary/${id}`, { method: "DELETE" });
    if (openId === id) {
      setOpenId(null);
      setDraft(null);
    }
    await load(query || undefined);
  }

  const setStats = (patch: Partial<MonsterDraft["stats"]>) =>
    setDraft((current) =>
      current ? { ...current, stats: { ...current.stats, ...patch } } : current,
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-stone-800 bg-stone-900/40 p-3">
        <h3 className="flex items-center gap-1.5 text-sm text-amber-100">
          <Skull className="size-4" /> Build a monster
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">Name</span>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value.slice(0, MONSTER_NAME_MAX))}
              placeholder="Bone Tyrant"
              className={cn(input, "w-48")}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">Starting CR</span>
            <select
              value={newCr}
              onChange={(event) => setNewCr(Number(event.target.value))}
              className={cn(input, "w-24")}
            >
              {CR_CHOICES.map((cr) => (
                <option key={cr} value={cr}>
                  {crLabel(cr)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={() => create({ from: "cr", name: newName.trim(), cr: newCr })}
            className="rounded-md border border-amber-500/40 px-3 py-1 text-xs text-amber-100 hover:bg-stone-800 disabled:opacity-40"
          >
            Start from the baseline
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-stone-500">
              Or start from something that exists
            </span>
            <div className="flex gap-1.5">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void load(query);
                  }
                }}
                placeholder="owlbear"
                className={cn(input, "flex-1")}
              />
              <button
                type="button"
                onClick={() => void load(query)}
                className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 text-xs text-stone-300 hover:text-amber-100"
              >
                <Search className="size-3.5" /> Find
              </button>
            </div>
          </label>
        </div>
        {found.length ? (
          <div className="flex flex-wrap gap-1">
            {found.map((entry) => (
              <button
                key={entry.slug}
                type="button"
                disabled={busy}
                onClick={() =>
                  create({
                    from: "monster",
                    slug: entry.slug,
                    name: newName.trim() || undefined,
                  })
                }
                className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[11px] text-stone-400 hover:text-amber-100 disabled:opacity-40"
              >
                {entry.name} <span className="text-stone-600">CR {crLabel(entry.cr)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        {monsters.length === 0 ? (
          <p className="text-xs text-stone-500">
            Nothing built yet. A monster made here answers to its name wherever a fight starts.
          </p>
        ) : null}
        {monsters.map((monster) => (
          <div key={monster.id} className="rounded-lg border border-stone-800 bg-stone-900/40">
            <div className="flex items-center gap-2 p-2">
              <button
                type="button"
                onClick={() => (openId === monster.id ? setOpenId(null) : open(monster))}
                className="flex-1 text-left"
              >
                <span className="text-sm text-stone-200">{monster.draft.name}</span>
                <span className="ml-2 text-[11px] text-stone-500">{monster.summary}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Duplicate ${monster.draft.name}`}
                // The "different button" the create route's from:"monster"
                // comment points at: copying the DM's own monster goes back
                // through from:"draft" with the block it already has.
                onClick={() =>
                  void create({
                    from: "draft",
                    draft: {
                      name: `${monster.draft.name} (copy)`.slice(0, MONSTER_NAME_MAX),
                      ...monster.draft.stats,
                      extraDamagePerRound: monster.draft.extraDamagePerRound,
                    },
                    desc: monster.desc,
                  })
                }
                className="text-stone-600 hover:text-stone-300 disabled:opacity-40"
              >
                <Copy className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void remove(monster.id)}
                className="text-stone-600 hover:text-red-300"
                aria-label={`Delete ${monster.draft.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {openId === monster.id && draft ? (
              <div className="flex flex-col gap-3 border-t border-stone-800 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-stone-500">Name</span>
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value.slice(0, MONSTER_NAME_MAX) })
                      }
                      className={cn(input, "w-48")}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-stone-500">
                      Challenge
                    </span>
                    <select
                      value={draft.stats.cr}
                      onChange={(event) => setStats({ cr: Number(event.target.value) })}
                      className={cn(input, "w-24")}
                    >
                      {CR_CHOICES.map((cr) => (
                        <option key={cr} value={cr}>
                          {crLabel(cr)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="AC"
                    value={draft.stats.ac}
                    min={1}
                    max={30}
                    onChange={(ac) => setStats({ ac })}
                  />
                  <NumberField
                    label="Hit points"
                    value={draft.stats.maxHp}
                    min={1}
                    max={1000}
                    onChange={(maxHp) => setStats({ maxHp })}
                  />
                  <NumberField
                    label="Swings"
                    value={draft.stats.attacksPerTurn ?? 1}
                    min={1}
                    max={3}
                    onChange={(attacksPerTurn) => setStats({ attacksPerTurn })}
                  />
                  <NumberField
                    label="Dex mod"
                    value={draft.stats.dexMod}
                    min={-5}
                    max={10}
                    onChange={(dexMod) => setStats({ dexMod })}
                  />
                </div>

                <MonsterKitPanel draft={draft} onChange={setDraft} />
                <AttackEditor draft={draft} onChange={setDraft} />
                <SaveEditor draft={draft} onChange={setDraft} />
                <TraitEditor draft={draft} onChange={setDraft} />
                <SizeAndDefences draft={draft} onChange={setDraft} />

                <NumberField
                  label="Extra damage a round"
                  value={draft.extraDamagePerRound}
                  min={0}
                  max={400}
                  onChange={(extraDamagePerRound) => setDraft({ ...draft, extraDamagePerRound })}
                  hint="A breath weapon or a round of spellcasting, averaged. The rating cannot see it otherwise."
                />

                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-stone-500">
                    What it is
                  </span>
                  <textarea
                    value={desc}
                    onChange={(event) => setDesc(event.target.value)}
                    rows={2}
                    placeholder="A knight's armour walking with nobody inside it."
                    className={cn(input, "w-full resize-y")}
                  />
                </label>

                {readout ? (
                  <>
                    <RatingLine readout={readout} />
                    <Working parts={readout.derived.parts} notes={readout.derived.notes} />
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                      {readout.against.map((row) => (
                        <span key={row.label} className="text-stone-500">
                          {row.label}{" "}
                          <span
                            className={cn(
                              row.verdict === "as expected" ? "text-stone-400" : "text-amber-300/80",
                            )}
                          >
                            {row.stat}
                          </span>{" "}
                          <span className="text-stone-600">
                            ({row.verdict}, CR {crLabel(readout.statedCr)} wants {row.expected})
                          </span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}

                {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 px-3 py-1 text-xs text-amber-100 hover:bg-stone-800 disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Save the block
                  </button>
                  <span className="text-[10px] text-stone-600">
                    Saving recalculates the rating from what is on screen.
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
