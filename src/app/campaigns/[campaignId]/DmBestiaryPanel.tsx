"use client";

import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { MonsterTile, ui } from "@/lib/ui";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { SectionHead } from "@/components/ui/SectionHead";
import { Listed, RowMenu } from "@/app/campaigns/[campaignId]/PanelKit";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import { DisclosureHead, quietRow } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { MONSTER_NAME_MAX, type MonsterDraft, type MonsterReadout } from "@/lib/bestiary/monster-draft";
import { Sheet } from "@/components/ui/Sheet";
import { useTourPrepare } from "@/lib/tours/prepare";
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
  // The table's setting, for the boss plate on high-rating thumbnails.
  const [genre, setGenre] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  // The tour's "unfold the builder" step.
  useTourPrepare((name) => {
    if (name === "open-monster-build") setBuilding(true);
  });
  const [draft, setDraft] = useState<MonsterDraft | null>(null);
  const [desc, setDesc] = useState("");
  const [readout, setReadout] = useState<MonsterReadout | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = layout === "rows";

  // A refused or failed list is settled, not dropped (issue 140), so the
  // list says "nothing built yet" only once the server has said so.
  const { loaded, loadError, settle } = useLoadStatus();
  const load = useCallback(
    (search?: string) =>
      readLoad<{ monsters: Monster[]; found: Found[]; genre?: string }>(
        fetch(`/api/campaigns/${campaignId}/dm/bestiary${search ? `?q=${encodeURIComponent(search)}` : ""}`),
        "The bestiary",
      ).then((outcome) => {
        if (outcome.payload) {
          setMonsters(outcome.payload.monsters);
          setFound(outcome.payload.found);
          setGenre(outcome.payload.genre ?? "");
        }
        settle(outcome);
      }),
    [campaignId, settle],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // "Start a workshop copy of this" from the rulebook (src/components/
  // rulebook/PagePrep.tsx): ?start=monster:<book page>. The book's monster
  // is copied from the catalog into the bestiary under a name of its own,
  // and opens; the parameter is then dropped.
  const start = useSearchParams().get("start");
  useEffect(() => {
    if (!start?.startsWith("monster:")) return;
    const pageId = start.slice("monster:".length);
    let live = true;
    void (async () => {
      const page = (await fetch(`/api/rulebook/pages/${encodeURIComponent(pageId)}`).then((response) => (response.ok ? response.json() : null))) as
        | { page?: { title: string }; crosswalk?: { catalogName?: string } }
        | null;
      if (!live || !page?.page) return;
      // The parameter goes once the copy is made: dropping it re-renders
      // this panel without it, which ends this effect.
      const done = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("start");
        window.history.replaceState(null, "", url.toString());
      };
      const wanted = page.crosswalk?.catalogName ?? page.page.title;
      const body = (await fetch(`/api/content/monsters?${new URLSearchParams({ q: wanted, limit: "20" })}`).then((response) => (response.ok ? response.json() : null))) as
        | { results?: Array<{ slug: string; name: string; documentSlug?: string; source?: string }> }
        | null;
      const rows = (body?.results ?? []).filter((entry) => entry.source !== "homebrew" && entry.name.toLowerCase() === wanted.toLowerCase());
      const row = rows.find((entry) => entry.documentSlug === "wotc-srd") ?? rows[0];
      if (!live) return;
      if (row) {
        await create({ from: "monster", slug: row.slug, name: `${row.name} Variant`.slice(0, MONSTER_NAME_MAX) });
      } else {
        setError(`${page.page.title} is not in the content pack on this server, so there is no block to copy.`);
      }
      done();
    })();
    return () => {
      live = false;
    };
    // The start parameter is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

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

  // A deleted monster is gone from every prepared fight that names it, so
  // it asks first, and a refusal says why instead of quietly doing nothing.
  async function remove(monster: Monster) {
    const id = monster.id;
    if (
      !(await appConfirm(
        `Forget ${monster.draft.name}? It leaves the bestiary and its pickers. An NPC, a prepared fight or a template that already names it still fights with its stat block as it is now.`,
        { title: "Forget this monster?", actionLabel: "Forget it" },
      ))
    ) {
      return;
    }
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}/dm/bestiary/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(payload?.error ?? (response ? "That could not be deleted." : "Could not reach the server."));
      return;
    }
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
          <DisclosureHead
            open={building}
            onToggle={() => setBuilding((current) => !current)}
            glyph="system-bestiary"
            title="Build a monster"
            tour="bestiary-build"
          />
          {building ? (
            <div className="reveal mt-3">
              <MonsterBuildControls
                busy={busy}
                found={found}
                query={query}
                onQuery={setQuery}
                onFind={() => void load(query)}
                onCreate={create}
                error={error}
                variant="bare"
                genre={genre}
              />
            </div>
          ) : null}
        </section>

        <div data-tour="bestiary-list">
          <Listed loaded={loaded} error={loadError} onRetry={() => void load()} loading="Opening the bestiary...">
            <MonsterRows
              monsters={monsters}
              busy={busy}
              genre={genre}
              onOpen={open}
              onDuplicate={(monster) => void duplicate(monster)}
              onDelete={(monster) => void remove(monster)}
            />
          </Listed>
        </div>

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
        genre={genre}
      />

      <div className="flex flex-col gap-1.5">
        <SectionHead
          title="Your monsters"
          glyph="system-bestiary"
          aside={monsters.length ? <span key={monsters.length} className="count-pop">{monsters.length}</span> : undefined}
        />
        <Listed loaded={loaded} error={loadError} onRetry={() => void load()} loading="Opening the bestiary...">
          {monsters.length === 0 ? (
            <EmptyState size="sm" art="chest" title="Nothing built yet. A monster made here answers to its name wherever a fight starts." />
          ) : null}
        </Listed>
        {monsters.map((monster) => {
          const isOpen = openId === monster.id;
          const toggle = () => (isOpen ? setOpenId(null) : open(monster));
          // The labels are the names the two icon buttons always announced.
          const items: ContextMenuItem[] = [
            { id: "open", label: isOpen ? "Close the stat block" : "Open the stat block", glyph: "system-bestiary", onSelect: toggle },
            { id: "duplicate", label: `Duplicate ${monster.draft.name}`, glyph: "system-homebrew", disabled: busy, onSelect: () => void duplicate(monster) },
            { id: "delete", label: `Delete ${monster.draft.name}`, glyph: "quest-failed", tone: "danger", separated: true, onSelect: () => void remove(monster) },
          ];
          return (
            <ContextMenu key={monster.id} items={items} label={monster.draft.name} className={cn(ui.card, "rounded-lg")}>
              <div className="flex items-center gap-2 p-2">
                <MonsterTile
                  type={monster.draft.stats.type}
                  cr={monster.draft.stats.cr}
                  genre={genre}
                  seed={monster.draft.name}
                  size="size-9"
                />
                <button type="button" onClick={toggle} aria-expanded={isOpen} className={cn(ui.btnSmall, quietRow, "flex-1 flex-wrap gap-x-2 gap-y-0")}>
                  <span className="text-sm text-stone-100">{monster.draft.name}</span>
                  <span className="text-[11px] text-stone-400">{monster.summary}</span>
                </button>
                <RowMenu items={items} label={monster.draft.name} />
              </div>

              {isOpen ? editor : null}
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
