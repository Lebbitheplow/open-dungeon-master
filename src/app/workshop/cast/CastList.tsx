"use client";

import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { npcPlaceholder, npcRoleLabel } from "@/lib/placeholders";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { ListTally, sortRows, type RowSort } from "@/app/workshop/ListHead";
import { describeNpc, draftFrom } from "@/lib/npcs/forge";

// The cast, two ways. CastChips is the DM console's compact row of names,
// moved here unchanged from DmNpcForgePanel. CastRows is the workshop's
// full-width list: portrait, attitude, where they are, the one line a player
// notices, how many people they have feelings about and what they want.
// Both hand the tap to the caller, which opens the editor.

export type Npc = {
  id: string;
  name: string;
  attitude: string;
  trait: string;
  location: string;
  // Optional so a roster fetched from a server that predates the column
  // still renders; the placeholder falls back to a hash of the name.
  role?: string;
  aliases: string[];
  portraitUrl: string;
  // The faction they belong to, or "" (optional for older servers).
  factionId?: string;
  archived: boolean;
  agency: {
    personality: Record<string, number> | null;
    goals: { scene?: string; session?: { text: string; progress: number; target: number }; ambition?: string };
    relations: Array<{ npcName: string; score: number; note?: string }>;
  };
};

type ListProps = {
  npcs: Npc[];
  selectedId: string;
  onOpen: (npc: Npc | null) => void;
  // Faction name by id, for the crest chip on each row.
  factionNames?: Map<string, string>;
};

export function CastChips({ npcs, selectedId, onOpen }: ListProps) {
  return (
    <section className="panel space-y-2 rounded-xl p-3">
      <SectionHead title="The cast" glyph="system-cast" className="mb-0" />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => onOpen(null)}
          className={cn(ui.btnSmall, "px-2 py-1", selectedId === "" && "border-amber-500/60 bg-amber-400/10 text-amber-100")}
        >
          <UserPlus className="size-3" /> Someone new
        </button>
        {npcs.map((npc) => (
          <button
            key={npc.id}
            type="button"
            title={describeNpc(draftFrom(npc as Parameters<typeof draftFrom>[0]))}
            onClick={() => onOpen(npc)}
            className={cn(
              ui.btnSmall,
              "px-2 py-1",
              npc.id === selectedId && "border-amber-500/60 bg-amber-400/10 text-amber-100",
              npc.archived && "opacity-50",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={npc.portraitUrl || npcPlaceholder(npc.role, npc.name)}
              alt=""
              className="size-5 rounded-full object-cover"
            />
            {npc.name}
          </button>
        ))}
      </div>
      {npcs.length === 0 ? (
        <p className="reveal text-[11px] text-stone-500">
          Nobody written yet. Everything here also fills itself in as the party meets people.
        </p>
      ) : null}
    </section>
  );
}

// The painted face of an attitude; "indifferent" is the engine's word for
// what the glyph set calls neutral.
const ATTITUDE_GLYPH: Record<string, string> = {
  friendly: "attitude-friendly",
  hostile: "attitude-hostile",
  indifferent: "attitude-neutral",
};

const ATTITUDE_TAG: Record<string, string> = {
  friendly: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  hostile: "border-red-500/40 bg-red-500/10 text-red-300",
  indifferent: "border-stone-600/60 bg-stone-800/60 text-stone-400",
};

// The first goal that has words in it, longest horizon first: an ambition
// says more about a person than what they want from the next scene.
function wants(npc: Npc): string {
  const { goals } = npc.agency;
  return (goals.ambition || goals.session?.text || goals.scene || "").trim();
}

function matches(npc: Npc, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [npc.name, ...npc.aliases].some((name) => name.toLowerCase().includes(needle));
}

export function CastRows({ npcs, onOpen, factionNames }: Omit<ListProps, "selectedId">) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RowSort>("made");
  const shown = sortRows(npcs.filter((npc) => matches(npc, query)), sort, (npc) => npc.name);

  return (
    <div className="space-y-2">
      <label className="relative block" data-tour="cast-search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the cast"
          aria-label="Search the cast by name or alias"
          className={`${ui.input} pl-9`}
        />
      </label>
      <ListTally shown={shown.length} total={npcs.length} noun={["person", "people"]} sort={sort} onSort={setSort} />

      <ul className="stagger space-y-2">
        {shown.map((npc) => {
          const goal = wants(npc);
          const relations = npc.agency.relations.length;
          return (
            <li key={npc.id}>
              <button
                type="button"
                onClick={() => onOpen(npc)}
                className={cn(
                  ui.cardHover,
                  "flex w-full items-start gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
                  npc.archived && "opacity-60",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={npc.portraitUrl || npcPlaceholder(npc.role, npc.name)}
                  alt=""
                  className="size-11 shrink-0 rounded-full border border-amber-400/25 bg-stone-950 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display tracking-wide text-amber-50">{npc.name}</span>
                    {npc.role ? (
                      <span className="text-xs text-stone-400">{npcRoleLabel(npc.role)}</span>
                    ) : null}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-display text-[10px] capitalize tracking-wider",
                        ATTITUDE_TAG[npc.attitude] ?? ATTITUDE_TAG.indifferent,
                      )}
                    >
                      <GameIcon icon={{ kind: "glyph", key: ATTITUDE_GLYPH[npc.attitude] ?? "attitude-neutral" }} size="size-4" />
                      {npc.attitude}
                    </span>
                    {npc.factionId && factionNames?.get(npc.factionId) ? (
                      <span className="flex items-center gap-0.5 rounded-sm border border-amber-800/60 bg-amber-950/30 px-1.5 py-0.5 text-[10px] tracking-wide text-amber-200/90">
                        <GameIcon icon={{ kind: "glyph", key: "system-factions" }} size="size-4" /> {factionNames.get(npc.factionId)}
                      </span>
                    ) : null}
                    {npc.archived ? (
                      <span className="rounded-sm border border-stone-600/60 px-1.5 py-0.5 font-display text-[10px] capitalize tracking-wider text-stone-500">
                        set aside
                      </span>
                    ) : null}
                  </div>
                  {npc.location ? (
                    <p className="reveal truncate text-xs text-stone-500">{npc.location}</p>
                  ) : null}
                  {npc.trait ? (
                    <p className="reveal mt-1 line-clamp-2 text-sm text-stone-300">{npc.trait}</p>
                  ) : null}
                  <p className="mt-1 truncate text-[11px] text-stone-500">
                    {relations} {relations === 1 ? "relationship" : "relationships"}
                    {goal ? <> · wants: {goal}</> : null}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => onOpen(null)}
            data-tour="cast-new"
            className={cn(
              ui.cardHover,
              "flex w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
            )}
          >
            <span className="relative shrink-0">
              <GameIcon icon={{ kind: "glyph", key: "system-cast" }} size="size-11" />
              <UserPlus className="absolute -bottom-1 -right-1 size-4 rounded-full bg-stone-900 p-0.5 text-amber-300" aria-hidden="true" />
            </span>
            <span className="font-display tracking-wide">Someone new</span>
          </button>
        </li>
      </ul>

      {npcs.length === 0 ? (
        <p className="reveal text-[11px] text-stone-500">
          Nobody written yet. Everything here also fills itself in as the party meets people.
        </p>
      ) : shown.length === 0 ? (
        <p className="live-in text-xs text-stone-500">Nobody by that name or alias.</p>
      ) : null}
    </div>
  );
}
