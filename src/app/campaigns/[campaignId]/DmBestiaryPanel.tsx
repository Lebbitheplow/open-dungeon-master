"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Skull, Trash2 } from "lucide-react";
import { ui } from "@/lib/ui";
import { MONSTER_NAME_MAX, type MonsterDraft, type MonsterReadout } from "@/lib/bestiary/monster-draft";
import { Sheet } from "@/components/ui/Sheet";
import { MonsterBuildControls } from "@/app/workshop/bestiary/MonsterBuildControls";
import { MonsterEditor } from "@/app/workshop/bestiary/MonsterEditor";
import { MonsterRows } from "@/app/workshop/bestiary/MonsterRows";
import type { Found, Monster } from "@/app/workshop/bestiary/types";

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
//
// Two layouts over one set of requests. "list" is the DM console's: the
// build controls in a card, then a compact entry per monster with the editor
// inline under whichever is open. "rows" is the workshop's: the build
// controls fold into a card, every monster is a full-width row, and the
// editor opens in a sheet (full height on a phone, a wide dialog on a desk)
// because a stat block is long and deserves the room.

export function DmBestiaryPanel({
  campaignId,
  layout = "list",
}: {
  campaignId: string;
  layout?: "list" | "rows";
}) {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [found, setFound] = useState<Found[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [draft, setDraft] = useState<MonsterDraft | null>(null);
  const [desc, setDesc] = useState("");
  const [readout, setReadout] = useState<MonsterReadout | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = layout === "rows";

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
    // In rows the editor lives in a sheet, so a tap on a row raises it.
    if (rows) {
      setEditorOpen(true);
    }
  }

  async function create(body: Record<string, unknown>): Promise<boolean> {
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
        return false;
      }
      await load(query || undefined);
      open(payload.monster);
      return true;
    } finally {
      setBusy(false);
    }
  }

  // The "different button" the create route's from:"monster" comment points
  // at: copying the DM's own monster goes back through from:"draft" with the
  // block it already has.
  function duplicate(monster: Monster) {
    return create({
      from: "draft",
      draft: {
        name: `${monster.draft.name} (copy)`.slice(0, MONSTER_NAME_MAX),
        ...monster.draft.stats,
        extraDamagePerRound: monster.draft.extraDamagePerRound,
      },
      desc: monster.desc,
    });
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
      setEditorOpen(false);
    }
    await load(query || undefined);
  }

  const editor =
    draft && openId ? (
      <MonsterEditor
        draft={draft}
        desc={desc}
        readout={readout}
        busy={busy}
        error={error}
        onDraft={setDraft}
        onDesc={setDesc}
        onSave={() => void save()}
        layout={rows ? "sheet" : "inline"}
      />
    ) : null;

  if (rows) {
    return (
      <div className="space-y-3">
        <section className={`${ui.card} p-3`}>
          <button
            type="button"
            onClick={() => setBuilding((current) => !current)}
            aria-expanded={building}
            className="flex w-full items-center gap-2 text-left font-display text-sm tracking-wide text-amber-100"
          >
            <Skull className="size-4 text-amber-300" />
            Build a monster
            {building ? (
              <ChevronDown className="ml-auto size-4 text-stone-500" />
            ) : (
              <ChevronRight className="ml-auto size-4 text-stone-500" />
            )}
          </button>
          {building ? (
            <div className="mt-3">
              <MonsterBuildControls
                busy={busy}
                found={found}
                query={query}
                onQuery={setQuery}
                onFind={() => void load(query)}
                onCreate={create}
                error={error}
                variant="bare"
              />
            </div>
          ) : null}
        </section>

        <MonsterRows
          monsters={monsters}
          busy={busy}
          onOpen={open}
          onDuplicate={(monster) => void duplicate(monster)}
          onDelete={(monster) => void remove(monster.id)}
        />

        <Sheet
          open={editorOpen && editor !== null}
          onOpenChange={setEditorOpen}
          title={draft?.name || "Monster"}
          className="top-0 h-dvh max-h-none rounded-none lg:top-1/2 lg:h-auto lg:max-h-[92vh] lg:w-[min(96vw,64rem)] lg:rounded-xl"
        >
          {editor}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MonsterBuildControls
        busy={busy}
        found={found}
        query={query}
        onQuery={setQuery}
        onFind={() => void load(query)}
        onCreate={create}
        error={error}
      />

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
                onClick={() => void duplicate(monster)}
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

            {openId === monster.id ? editor : null}
          </div>
        ))}
      </div>
    </div>
  );
}
