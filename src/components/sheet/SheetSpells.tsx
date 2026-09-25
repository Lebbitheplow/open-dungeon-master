"use client";

import { useState } from "react";
import { spellClassFor } from "@/lib/classes";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import {
  casterViewsOf,
  grantedSpellsOf,
  heldSpells,
  maxSpellLevelOf,
  preparedCount,
  spellCapOf,
  spellbookOf,
  type CasterView,
} from "@/lib/srd/spell-prep";
import { SpellBook, type SpellTile } from "./SpellBook";
import { useSpellLookups, useSpellPool, type PoolSpell } from "./useSpellPool";

// A character's spells as a spell book, one per caster class. The owner of a
// prepared caster can change what is prepared right here: unpreparing takes
// effect at once, a new pick waits for the next long rest
// (src/lib/srd/spell-prep.ts, POST /sheet/spells). Everyone else reads it.

const titleCase = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function SheetSpells({
  sheet,
  editable = false,
}: {
  sheet: Pick<CharacterSheet, "class" | "level" | "subclass" | "classes" | "abilities" | "spellcasting"> & {
    id?: string;
    campaignId?: string;
  };
  // The owner, in a campaign: may change prepared spells.
  editable?: boolean;
}) {
  const views = casterViewsOf(sheet);
  if (!views.length) {
    return null;
  }
  return (
    <div className="space-y-4">
      {views.map((view) => (
        <CasterBook
          key={view.classId}
          view={view}
          sheet={sheet}
          editable={editable && Boolean(sheet.campaignId)}
          showClass={views.length > 1}
        />
      ))}
    </div>
  );
}

function CasterBook({
  view,
  sheet,
  editable,
  showClass,
}: {
  view: CasterView;
  sheet: Parameters<typeof SheetSpells>[0]["sheet"];
  editable: boolean;
  showClass: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "note" | "error"; text: string } | null>(null);
  const maxLevel = maxSpellLevelOf(view);
  const canPrepare = editable && view.style !== "known";
  // The whole class list is only needed while a prepared caster edits.
  const { pool, loading } = useSpellPool(
    spellClassFor(view.classId),
    maxLevel,
    editing && view.style === "prepared",
  );

  // Pack and homebrew spells the checklist does not know get their level
  // from the pack, so none lands under a blank tab.
  const lookups = useSpellLookups([
    ...view.cantrips,
    ...view.known,
    ...view.prepared,
    ...view.pending,
    ...view.spellbook,
  ]);
  const tiles = buildTiles(view, [...lookups.values(), ...(editing ? pool : [])], editing);
  const cap = spellCapOf(view, sheet.abilities);
  const counters = [
    ...(view.cantrips.length ? [{ label: "Cantrips", value: view.cantrips.length }] : []),
    view.style === "known"
      ? { label: "Known", value: heldSpells(view).filter((name) => !isGranted(view, name)).length, max: cap?.count }
      : {
          label: "Prepared",
          value: preparedCount(view),
          max: cap?.count,
          extra: view.pending.length ? `(${view.pending.length} at long rest)` : undefined,
        },
    ...(view.style === "spellbook" ? [{ label: "Spellbook", value: spellbookOf(view).length }] : []),
  ];

  async function toggle(tile: SpellTile) {
    const action =
      tile.state === "pending" ? "cancel" : tile.state === "ready" ? "unprepare" : "prepare";
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/campaigns/${sheet.campaignId}/sheet/spells`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, spell: tile.name, classId: view.classId, sheetId: sheet.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; note?: string };
      setMessage(
        response.ok
          ? { tone: "note", text: data.note ?? "Done." }
          : {
              tone: "error",
              // A 404 means the server answering does not have this action
              // (an older build, or a portal host not yet updated).
              text:
                data.error ??
                (response.status === 404
                  ? "The server does not know how to change prepared spells yet (HTTP 404). Restart or update the server this table runs on."
                  : `Could not change that spell (HTTP ${response.status}).`),
            },
      );
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {showClass ? (
        <p className="eyebrow mb-1.5 text-[10px] text-amber-400/80">{titleCase(view.classId)}</p>
      ) : null}
      <SpellBook
        tiles={tiles}
        maxLevel={maxLevel}
        counters={counters}
        busy={busy}
        onTile={editing ? toggle : undefined}
        canToggle={(tile) => tile.state !== "granted" && tile.level !== 0}
        emptyText={editing ? (loading ? "Loading the class list..." : "Nothing to prepare at this level.") : "Nothing prepared at this level."}
        header={
          canPrepare ? (
            <button
              type="button"
              onClick={() => {
                setEditing((current) => !current);
                setMessage(null);
              }}
              className={
                editing
                  ? "ml-auto rounded-full bg-amber-300 px-3 py-0.5 text-xs font-medium text-stone-950 hover:bg-amber-200"
                  : "ml-auto rounded-full border border-amber-500/50 px-3 py-0.5 text-xs text-amber-200 hover:bg-amber-400/10"
              }
            >
              {editing ? "Done" : view.style === "spellbook" ? "Prepare from spellbook" : "Change prepared spells"}
            </button>
          ) : null
        }
        footer={
          <>
            {editing ? (
              <p className="mt-2 text-[11px] text-stone-500">
                Tap a spell to prepare it: it becomes ready after your next long rest. Tapping a
                ready spell unprepares it at once. Cantrips and subclass spells never change.
              </p>
            ) : view.style === "known" && editable ? (
              <p className="mt-2 text-[11px] text-stone-500">
                You know these spells and always have them ready. You can swap one when you level up.
              </p>
            ) : null}
            {message ? (
              <p
                role={message.tone === "error" ? "alert" : "status"}
                className={message.tone === "error" ? "mt-2 text-xs text-red-300" : "mt-2 text-xs text-sky-300"}
              >
                {message.text}
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}

function isGranted(view: CasterView, name: string) {
  return grantedSpellsOf(view).some((entry) => entry.toLowerCase() === name.toLowerCase());
}

// Tiles for one caster: what is ready, what waits, and while editing what
// could be prepared (the class list, or a wizard's book).
// `pool` is every pack row at hand: the class list while editing, plus the
// looked-up rows for this caster's own pack spells (already taken, so they
// never turn into "available" tiles).
function buildTiles(view: CasterView, pool: PoolSpell[], editing: boolean): SpellTile[] {
  const levels = new Map(pool.map((spell) => [spell.name.toLowerCase(), spell]));
  const tile = (name: string, state: SpellTile["state"]): SpellTile => {
    const row = levels.get(name.toLowerCase());
    return {
      name,
      level: row?.level ?? spellLevelOf(name),
      state,
      data: row?.data,
      slug: row?.slug,
      homebrew: row?.source === "homebrew",
    };
  };
  const granted = grantedSpellsOf(view);
  const taken = new Set<string>();
  // First state wins: a name an older sheet wrote in two lists is one tile.
  const tiles: SpellTile[] = [
    ...view.cantrips.map((name) => ({ ...tile(name, "ready"), level: 0 })),
    ...granted.map((name) => tile(name, "granted")),
    ...heldSpells(view).map((name) => tile(name, "ready")),
    ...view.pending.map((name) => tile(name, "pending")),
  ].filter((entry) => {
    const key = entry.name.toLowerCase();
    if (taken.has(key)) {
      return false;
    }
    taken.add(key);
    return true;
  });
  if (view.style === "spellbook") {
    // The book is always worth seeing: it is what the wizard owns.
    tiles.push(
      ...spellbookOf(view)
        .filter((name) => !taken.has(name.toLowerCase()))
        .map((name) => tile(name, "inBook")),
    );
  } else if (editing && view.style === "prepared") {
    tiles.push(
      ...pool
        .filter((spell) => spell.level > 0 && !taken.has(spell.name.toLowerCase()))
        .map((spell) => tile(spell.name, "available")),
    );
  }
  return tiles;
}
