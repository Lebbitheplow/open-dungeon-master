"use client";

import { useEffect, useRef, useState } from "react";
import spellManifest from "@/lib/srd/manifest/spells.json";
import { spellLevelOf } from "@/lib/srd/spell-lists";

// Every spell a class can take up to a spell level, for the spell book's
// "available" tiles: the content pack (homebrew included) when installed,
// the bundled checklist when it is not. Fetched once per class and level.

export type PoolSpell = {
  name: string;
  level: number;
  slug?: string;
  source?: "open5e" | "homebrew";
  data?: Record<string, unknown>;
};

const PAGE = 200;
const cache = new Map<string, PoolSpell[]>();

type ManifestSpell = { n: string; l: number; c?: string };

function checklistPool(classSlug: string, maxLevel: number): PoolSpell[] {
  const wanted = classSlug.toLowerCase();
  return (spellManifest as { spells: ManifestSpell[] }).spells
    .filter(
      (spell) =>
        spell.l <= maxLevel &&
        (spell.c ?? "").split(",").some((entry) => entry.trim().toLowerCase() === wanted),
    )
    .map((spell) => ({ name: spell.n, level: spell.l }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function uniqueByName(rows: PoolSpell[]): PoolSpell[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Level and pack row for spells the bundled checklist does not name (a pack
// or homebrew spell on a sheet), looked up one by one and remembered for
// the page's life. Names the checklist knows never cost a request.
const lookups = new Map<string, PoolSpell | null>();

export function useSpellLookups(names: string[]): Map<string, PoolSpell> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))].filter(
    (name) => spellLevelOf(name) === null,
  );
  const missing = wanted.filter((name) => !lookups.has(name.toLowerCase()));
  const [, setVersion] = useState(0);
  const missingKey = missing.join("|");

  // Every answer re-renders whoever is still on screen, even when a newer
  // render already started other lookups: a flag cleared by the effect's own
  // cleanup used to drop the answer, leaving pack spells under "Other" until
  // the next click happened to re-render the book.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!missingKey) {
      return;
    }
    for (const name of missingKey.split("|")) {
      void lookUp(name).then(() => {
        if (mounted.current) {
          setVersion((value) => value + 1);
        }
      });
    }
  }, [missingKey]);

  const found = new Map<string, PoolSpell>();
  for (const name of wanted) {
    const row = lookups.get(name.toLowerCase());
    if (row) {
      found.set(name.toLowerCase(), row);
    }
  }
  return found;
}

// One request per name however many books ask for it at once.
const inFlight = new Map<string, Promise<void>>();

function lookUp(name: string): Promise<void> {
  const key = name.toLowerCase();
  if (lookups.has(key)) {
    return Promise.resolve();
  }
  const running = inFlight.get(key);
  if (running) {
    return running;
  }
  const request = (async () => {
    try {
      const params = new URLSearchParams({ q: name, limit: "10" });
      const response = await fetch(`/api/content/spells?${params}`);
      const body = response.ok
        ? ((await response.json()) as { results?: Array<PoolSpell & { slug: string }> })
        : {};
      const row = (body.results ?? []).find((entry) => entry.name.trim().toLowerCase() === key);
      lookups.set(
        key,
        row
          ? { name: row.name, level: Number(row.level ?? 0), slug: row.slug, source: row.source, data: row.data }
          : null,
      );
    } catch {
      // Unreachable now; the next render may try again.
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}

export function useSpellPool(
  classSlug: string,
  maxLevel: number,
  enabled = true,
): { pool: PoolSpell[]; loading: boolean } {
  const key = `${classSlug.toLowerCase()}:${maxLevel}`;
  const [loaded, setLoaded] = useState<{ key: string; pool: PoolSpell[] } | null>(() =>
    cache.has(key) ? { key, pool: cache.get(key) ?? [] } : null,
  );

  useEffect(() => {
    if (!enabled || !classSlug || cache.has(key)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows: PoolSpell[] = [];
      let fallback = false;
      try {
        for (let offset = 0; offset < 2000; offset += PAGE) {
          const params = new URLSearchParams({
            class: classSlug,
            level: String(maxLevel),
            limit: String(PAGE),
            offset: String(offset),
          });
          const response = await fetch(`/api/content/spells?${params}`);
          if (!response.ok) {
            fallback = true;
            break;
          }
          const body = (await response.json()) as {
            results?: Array<PoolSpell & { slug: string }>;
            packInstalled?: boolean;
          };
          if (body.packInstalled === false) {
            fallback = true;
          }
          const page = body.results ?? [];
          rows.push(
            ...page.map((row) => ({
              name: row.name,
              level: Number(row.level ?? 0),
              slug: row.slug,
              source: row.source,
              data: row.data,
            })),
          );
          if (page.length < PAGE) {
            break;
          }
        }
      } catch {
        fallback = true;
      }
      const pool = uniqueByName(
        fallback ? [...rows, ...checklistPool(classSlug, maxLevel)] : rows,
      );
      cache.set(key, pool);
      if (!cancelled) {
        setLoaded({ key, pool });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, classSlug, maxLevel, key]);

  const pool = loaded?.key === key ? loaded.pool : (cache.get(key) ?? null);
  return { pool: pool ?? [], loading: enabled && Boolean(classSlug) && pool === null };
}
