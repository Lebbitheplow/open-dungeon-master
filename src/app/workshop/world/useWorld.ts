"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import type { Slice, WorldDoc } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";
import { applyRowOps, docOps, type DocOps } from "@/lib/worldforge/ops";

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
      if (outcome.payload) setWorld(outcome.payload);
    });
    return () => {
      cancelled = true;
    };
  }, [base, reload, settle]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  const send = useCallback(async (url: string, init: RequestInit) => {
    setInFlight((count) => count + 1);
    setError("");
    try {
      const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "That did not save.");
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
  const patch = useCallback(
    async (slices: Partial<Pick<WorldDoc, Exclude<Slice, "entries">>> & { moveFolder?: { from: string; to: string } }) => {
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
            const fresh = payload as unknown as WorldState & { conflicts?: string[] };
            setWorld(withPending({ doc: fresh.doc, entities: fresh.entities }));
            if (fresh.conflicts?.length) setError(fresh.conflicts.join(" "));
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
            entities: [...current.entities.filter((entry) => entry.ref !== entity.ref), entity].sort((a, b) => a.name.localeCompare(b.name)),
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

  const update = useCallback(
    async (ref: string, input: EntryInput) => {
      const payload = await send(`${base}/entities/${encodeURIComponent(ref)}`, { method: "PATCH", body: JSON.stringify(input) });
      const entity = payload?.entity as WorldEntity | undefined;
      if (entity) placeEntity(entity);
      return entity ?? null;
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

  const importFile = useCallback(
    async (text: string) => {
      const payload = await send(`${base}/import`, { method: "POST", body: JSON.stringify({ text }) });
      if (payload) refresh();
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

  return { world, loaded, loadError, error, saving, refresh, patch, create, update, remove, importFile, ai, clearError: () => setError("") };
}

export type WorldApi = ReturnType<typeof useWorld>;
