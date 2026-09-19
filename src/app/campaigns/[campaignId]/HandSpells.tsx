"use client";

import { useEffect, useMemo, useState } from "react";
import { spellKey, spellsToLookUp, type SpellFact } from "@/lib/battlemap/hand";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// What the content pack says about the spells on a sheet, for the Hand's
// spell cards: level, casting time, range and the prose the mechanics are
// parsed from. Read through the content search the level-up dialog already
// uses, once per spell per page; a table without the pack simply gets the
// authored rows hand.ts falls back to.

type SpellResult = {
  name: string;
  level: number;
  school: string;
  concentration: boolean;
  aliases?: string[];
  documentSlug?: string;
  data: Record<string, unknown>;
};

// null = looked up and not found, so it is not asked for again.
const cache = new Map<string, SpellFact | null>();

function toFact(entry: SpellResult): SpellFact {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    level: entry.level,
    school: entry.school,
    castingTime: text(entry.data.casting_time),
    range: text(entry.data.range),
    desc: text(entry.data.desc),
    higherLevel: text(entry.data.higher_level),
    concentration: entry.concentration,
  };
}

async function lookUp(name: string): Promise<SpellFact | null> {
  const response = await fetch(`/api/content/spells?q=${encodeURIComponent(name)}&limit=8`);
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: SpellResult[] };
  const wanted = spellKey(name);
  const exact = (body.results ?? []).filter(
    (entry) => spellKey(entry.name) === wanted || (entry.aliases ?? []).some((alias) => spellKey(alias) === wanted),
  );
  // The SRD's own wording is what the engine's parsers were written against.
  const best = exact.find((entry) => entry.documentSlug !== "a5e") ?? exact[0];
  return best ? toFact(best) : null;
}

export function useHandSpells(sheet: CharacterSheet | null): Record<string, SpellFact> {
  const names = useMemo(() => (sheet ? spellsToLookUp(sheet) : []), [sheet]);
  const wanted = names.map(spellKey).join("|");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const missing = wanted.split("|").filter((key) => key && !cache.has(key));
    if (!missing.length) return;
    let live = true;
    void Promise.all(
      missing.map(async (key) => {
        try {
          cache.set(key, await lookUp(key));
        } catch {
          // Offline or refused: left out of the cache so a later turn retries.
        }
      }),
    ).then(() => {
      if (live) setVersion((current) => current + 1);
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  return useMemo(() => {
    const out: Record<string, SpellFact> = {};
    for (const key of wanted.split("|")) {
      const fact = cache.get(key);
      if (fact) out[key] = fact;
    }
    return out;
    // `version` is the cache's change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, version]);
}
