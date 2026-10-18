"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import type { Slice, WorldDoc } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";
import { applyRowOps, docOps, type DocOps } from "@/lib/worldforge/ops";
import { byName } from "@/lib/language/text-logic";
import type { Editable, EntryConflict } from "@/lib/worldforge/entry-merge";
import type { Placement, RegionBridge } from "@/lib/db/atlas-region";

// The workshop's WorldForge on the client: one load of the document and the
// records it describes, slice saves that show at once and settle when the
// server answers, and entry calls that answer with the entry as stored.
//
// A slice save is the rows it changed against the document the editor was
// showing (src/lib/worldforge/ops.ts), not the whole slice: the saves go one
// after another, each laid over the server's newest answer, so a later edit
// never rides on a stale copy and a refused save takes back only its own
// rows (the server's copy is read again, with what is still queued laid
// over it). Two editors in two tabs keep each other's rows; a row both
// changed is kept as the first saved it and named in `error`.

export type WorldState = { doc: WorldDoc; entities: WorldEntity[] };
export type UpdateOutcome = { entity: WorldEntity } | { conflicts: EntryConflict[]; entity: WorldEntity } | null;

export type EntryInput = Partial<Omit<WorldEntity["entry"], "wfId">> & {
  name?: string;
  tagline?: string;
  text?: string;
  aliases?: string[];
  tags?: string[];
  portrait?: string;
};

export function useWorld(campaignId: string) {
  const [world, setWorld] = useState<WorldState | null>(null);
  const [error, setError] = useState("");
  // Requests not answered yet, slice saves queued included: "saving" lasts
  // until the last of them is.
  const [inFlight, setInFlight] = useState(0);
  const saving = inFlight > 0;
  const { loaded, loadError, settle } = useLoadStatus();
  const [reload, setReload] = useState(0);
  const base = `/api/campaigns/${campaignId}/world`;
  // Slice saves sent or waiting, in order, and the chain they wait on.
  const pending = useRef<Array<{ ops: DocOps }>>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The server's state with every save still waiting laid over it.
  const withPending = useCallback(
    (state: WorldState): WorldState => pending.current.reduce((current, entry) => ({ ...current, doc: applyRowOps(current.doc, entry.ops).doc }), state),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    readLoad<WorldState>(fetch(base), "The world").then((outcome) => {
      if (cancelled) return;
      settle(outcome);
      // A reload while saves are still waiting keeps them laid over it.
      if (outcome.payload) setWorld(withPending(outcome.payload));
    });
    return () => {
      cancelled = true;
    };
  }, [base, reload, settle, withPending]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  const send = useCallback(async (url: string, init: RequestInit) => {
    setInFlight((count) => count + 1);
    setError("");
    try {
      const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "That did not save.");
        // Another author changed the same fields: the caller gets them, and
        // the entry as it is now, to keep its draft and show what changed.
        if (response.status === 409 && Array.isArray(payload.conflicts)) return { ...payload, conflicted: true } as Record<string, unknown>;
        return null;
      }
      return payload as Record<string, unknown>;
    } catch {
      setError("The server could not be reached.");
      return null;
    } finally {
      setInFlight((count) => count - 1);
    }
  }, []);

  // Changes slices: shown at once, saved in order as the rows it changed
  // against `world`, the document the caller computed its slices from.
  // `onRegion` hears of each Region marker a bound Atlas pin took with it
  // (src/lib/db/atlas-region.ts followPins), with where it stood before.
  const patch = useCallback(
    async (
      slices: Partial<Pick<WorldDoc, Exclude<Slice, "entries">>> & { moveFolder?: { from: string; to: string } },
      options?: { onRegion?: (moves: Placement[]) => void },
    ) => {
      const seen = world;
      if (!seen) return false;
      const rest: Partial<Pick<WorldDoc, Exclude<Slice, "entries">>> = { ...slices };
      delete (rest as { moveFolder?: unknown }).moveFolder;
      const ops = docOps(seen.doc, rest);
      const move = slices.moveFolder;
      if (!Object.keys(ops).length && !move) return true;
      const entry = { ops };
      pending.current.push(entry);
      setWorld((current) => (current ? { ...current, doc: applyRowOps(current.doc, ops).doc } : current));
      setInFlight((count) => count + 1);
      const run = queue.current.then(async () => {
        try {
          const payload = await send(base, { method: "PATCH", body: JSON.stringify({ ops, ...(move ? { moveFolder: move } : {}) }) });
          pending.current = pending.current.filter((other) => other !== entry);
          if (payload) {
            const fresh = payload as unknown as WorldState & { conflicts?: string[]; region?: Placement[] };
            setWorld(withPending({ doc: fresh.doc, entities: fresh.entities }));
            if (fresh.conflicts?.length) setError(fresh.conflicts.join(" "));
            if (fresh.region?.length) options?.onRegion?.(fresh.region);
            return !fresh.conflicts?.length;
          }
          // Refused or unreachable: this save's rows go back to what the
          // server holds; the saves still queued stay on top.
          const reloaded = (await fetch(base).then((response) => (response.ok ? response.json() : null)).catch(() => null)) as WorldState | null;
          if (reloaded) setWorld(withPending(reloaded));
          return false;
        } finally {
          setInFlight((count) => count - 1);
        }
      });
      queue.current = run.catch(() => false);
      return run;
    },
    [base, send, world, withPending],
  );

  const placeEntity = (entity: WorldEntity) =>
    setWorld((current) =>
      current
        ? {
            doc: { ...current.doc, entries: { ...current.doc.entries, [entity.ref]: entity.entry } },
            entities: [...current.entities.filter((entry) => entry.ref !== entity.ref), entity].sort(byName),
          }
        : current,
    );

  const create = useCallback(
    async (input: EntryInput & { typeId: string; name: string }) => {
      const payload = await send(`${base}/entities`, { method: "POST", body: JSON.stringify(input) });
      const entity = payload?.entity as WorldEntity | undefined;
      if (entity) placeEntity(entity);
      return entity ?? null;
    },
    [base, send],
  );

  // An entry's changed fields, each with the value the editor opened with.
  // Resolves to the saved entry, to the conflicting fields (nothing saved,
  // the entry as it is now beside them), or to null on any other failure.
  const update = useCallback(
    async (ref: string, input: EntryInput, opened?: Partial<Editable>): Promise<UpdateOutcome> => {
      const body = opened ? { ...input, base: opened } : input;
      const payload = await send(`${base}/entities/${encodeURIComponent(ref)}`, { method: "PATCH", body: JSON.stringify(body) });
      const entity = payload?.entity as WorldEntity | undefined;
      if (payload?.conflicted && entity) {
        placeEntity(entity);
        return { conflicts: payload.conflicts as EntryConflict[], entity };
      }
      if (entity) placeEntity(entity);
      return entity ? { entity } : null;
    },
    [base, send],
  );

  const remove = useCallback(
    async (ref: string) => {
      const payload = await send(`${base}/entities/${encodeURIComponent(ref)}`, { method: "DELETE" });
      if (payload) refresh();
      return Boolean(payload);
    },
    [base, send, refresh],
  );

  // A file that would not come in whole answers with what it would lose
  // (`preview`); `accept` brings it in anyway.
  const importFile = useCallback(
    async (text: string, accept = false) => {
      const payload = await send(`${base}/import`, { method: "POST", body: JSON.stringify({ text, accept }) });
      if (payload && !payload.preview) refresh();
      return payload;
    },
    [base, send, refresh],
  );

  // WorldForge's AI tools (src/lib/dm/world-ai.ts): forge, ask, draft,
  // paint, and apply for a forge preview's ticked rows.
  const ai = useCallback(
    async (tool: "forge" | "ask" | "draft" | "paint" | "apply", body: Record<string, unknown>) => {
      const payload = await send(`${base}/ai`, { method: "POST", body: JSON.stringify({ tool, ...body }) });
      if (payload && tool === "apply") refresh();
      return payload;
    },
    [base, send, refresh],
  );

  // "Reveal to the party" at a table: the secret marked learned and a lore
  // entry for the players, made on the server in one step (world/secrets/
  // [secretId]/reveal). Answers the entry made, or null with `error` said.
  const reveal = useCallback(
    async (secretId: string, told: { title: string; body: string; show: boolean }) => {
      const payload = await send(`${base}/secrets/${encodeURIComponent(secretId)}/reveal`, { method: "POST", body: JSON.stringify(told) });
      if (!payload || !payload.entry) return null;
      const fresh = payload as unknown as WorldState;
      setWorld(withPending({ doc: fresh.doc, entities: fresh.entities }));
      return payload.entry as { id: string; title: string };
    },
    [base, send, withPending],
  );

  // The Atlas's Region steps (world/region, src/lib/db/atlas-region.ts).
  // `readRegion` says where things stand, quietly: it is read again after
  // every change, and a failed read shows nothing rather than an error. The
  // steps answer with their review, or with what they did once applied, and
  // a step that changed anything reads the world again.
  const readRegion = useCallback(
    () => fetch(`${base}/region`).then((response) => (response.ok ? (response.json() as Promise<RegionBridge>) : null)).catch(() => null),
    [base],
  );
  const region = useCallback(
    async (method: "POST" | "DELETE", step: "backdrop" | "places", body?: Record<string, unknown>, query = "") => {
      const payload = await send(`${base}/region/${step}${query}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (payload && (method === "DELETE" || payload.applied)) refresh();
      return payload;
    },
    [base, send, refresh],
  );

  // A place's own battle map or encounter, made and linked in one request
  // (src/app/api/campaigns/[campaignId]/world/entities/[ref]/battle-maps).
  // Resolves to what was made, or null with the server's reason in `error`.
  const makeForPlace = useCallback(
    async (ref: string, body: { make: "map" } | { make: "encounter"; monster: string; mapId?: string }): Promise<{ kind: "map" | "encounter"; id: string } | null> => {
      const payload = await send(`${base}/entities/${encodeURIComponent(ref)}/battle-maps`, { method: "POST", body: JSON.stringify(body) });
      const entity = payload?.entity as WorldEntity | undefined;
      if (entity) placeEntity(entity);
      return (payload?.made as { kind: "map" | "encounter"; id: string } | undefined) ?? null;
    },
    [base, send],
  );

  // The Atlas's own steps (world/atlas, src/lib/db/atlas-edit.ts): delete
  // with an undo token, restore by it, and a map's frame. Each answers with
  // its review, or with what it did; a delete or restore carries the world.
  const atlasStep = useCallback(
    async (step: "delete" | "restore" | "frame", body: Record<string, unknown>) => {
      const payload = await send(`${base}/atlas/${step}`, { method: "POST", body: JSON.stringify(body) });
      if (payload?.doc) {
        const fresh = payload as unknown as WorldState;
        setWorld(withPending({ doc: fresh.doc, entities: fresh.entities }));
      } else if (payload?.applied) refresh();
      return payload;
    },
    [base, send, refresh, withPending],
  );

  // The party's Atlas (world/atlas/party, src/lib/db/party-atlas.ts): POST
  // reviews or shows a map, DELETE hides one; either reads the world again
  // once it changed something.
  const party = useCallback(
    async (method: "POST" | "DELETE", body: Record<string, unknown>) => {
      const payload = await send(`${base}/atlas/party`, { method, body: JSON.stringify(body) });
      if (payload?.applied || payload?.hidden) refresh();
      return payload;
    },
    [base, send, refresh],
  );

  return { campaignId, world, loaded, loadError, error, saving, refresh, patch, create, update, remove, importFile, ai, reveal, readRegion, region, makeForPlace, atlasStep, party, clearError: () => setError("") };
}

export type WorldApi = ReturnType<typeof useWorld>;
