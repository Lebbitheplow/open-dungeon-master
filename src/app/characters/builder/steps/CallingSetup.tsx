"use client";

import { useEffect, useState } from "react";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { Select } from "@/components/ui/Select";
import type { WorldPack } from "@/lib/worlds/types";
import type { BuilderState } from "../useBuilderState";
import { Field } from "./shared";

// What the first step says and asks before the class (backlog F4): the
// setting notices, so the first thing a player sees under a world pack is
// whose words they are about to choose from, and the level, which decides
// what every later step offers (features, subclass, spells, improvements),
// so it is set before any of them.

// `packInstalled` is null while the option lists are still loading.
export function ContentNotices({ pack, packInstalled }: { pack: WorldPack | null; packInstalled: boolean | null }) {
  // The install command is for whoever runs the server. A player can do
  // nothing with it, and a first-timer read it as something being broken.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (packInstalled !== false) {
      return;
    }
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setIsAdmin(Boolean(data?.user?.isAdmin)))
      .catch(() => undefined);
  }, [packInstalled]);

  return (
    <>
      {packInstalled === null ? (
        <p role="status" className="rounded-lg border border-stone-700/60 bg-stone-900/60 p-3 text-xs text-stone-400">
          Loading the races, classes and backgrounds this server offers…
        </p>
      ) : !packInstalled ? (
        <p className="rounded-lg border border-stone-700/60 bg-stone-900/60 p-3 text-xs text-stone-400">
          {isAdmin ? (
            <>
              Content pack not installed; showing SRD 5.1 basics only. Run
              <span className="font-mono"> node scripts/import-open5e.mjs</span> on the server
              for the full Open5e catalog.
            </>
          ) : (
            "This server uses the basic rules set (SRD 5.1), so some races, classes and backgrounds from other books are not offered."
          )}
        </p>
      ) : null}
      {pack ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-xs text-amber-100">
            <span className="font-medium">{pack.name}</span> · {pack.blurb}
          </p>
          <p className="mt-1 text-sm text-stone-400">
            Names only. Every race, class, spell and item below plays by the same 5e rules.
          </p>
          <UnofficialPackNotice
            rightsHolder={pack.rightsHolder}
            inspiredBy={pack.inspiredBy}
            variant="inline"
            className="mt-1"
          />
        </div>
      ) : null}
    </>
  );
}

// The level select: fixed by a campaign, otherwise open from the lowest
// level the stored character's improvements allow. A character whose
// levels are split between classes moves too (backlog F9): a lower level
// comes off the last class taken. The library door's level (door.ts) opens
// it, with its note beside it.
export function LevelField({
  state,
  fixedLevel,
  levelNote,
  className,
}: {
  state: BuilderState;
  fixedLevel?: number;
  // Why the level select opened where it did (door.ts).
  levelNote?: string;
  className?: string;
}) {
  return (
    <Field label="Level" className={className}>
      {fixedLevel ? (
        <span className="block rounded-lg border border-stone-700/70 bg-stone-950/60 px-3 py-2 text-sm text-stone-400">
          {fixedLevel} (campaign)
        </span>
      ) : (
        <>
          <Select<string>
            value={String(state.level)}
            onChange={(next) => state.changeLevel(Number(next))}
            label="Level"
            className="w-full"
            options={Array.from({ length: 21 - state.levelFloor }, (_, index) => ({
              value: String(index + state.levelFloor),
              label: String(index + state.levelFloor),
            }))}
          />
          {state.levelFloor > 1 ? (
            <span className="mt-1 block text-xs text-stone-500">
              Improvements taken in play are in their scores, so they stay level {state.levelFloor} or higher.
            </span>
          ) : levelNote ? (
            <span className="mt-1 block text-xs text-stone-500">{levelNote}</span>
          ) : null}
        </>
      )}
    </Field>
  );
}
