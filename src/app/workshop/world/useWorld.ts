"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import type { Slice, WorldDoc } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";

// The workshop's WorldForge on the client: one load of the document and the
// records it describes, slice saves that show at once and settle when the
// server answers (a refused save puts the server's copy back and says why),
// and entry calls that answer with the entry as stored.

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
  const [saving, setSaving] = useState(false);
  const { loaded, loadError, settle } = useLoadStatus();
  const [reload, setReload] = useState(0);
  const base = `/api/campaigns/${campaignId}/world`;
  // The newest document, for saves queued behind one another.
  const latest = useRef<WorldState | null>(null);
  useEffect(() => {
    latest.current = world;
  }, [world]);

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
    setSaving(true);
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
      setSaving(false);
    }
  }, []);

  // Replaces whole slices, shown before the server answers.
  const patch = useCallback(
    async (slices: Partial<Pick<WorldDoc, Exclude<Slice, "entries">>> & { moveFolder?: { from: string; to: string } }) => {
      const before = latest.current;
      if (before) {
        const rest: Record<string, unknown> = { ...slices };
        delete rest.moveFolder;
        setWorld({ ...before, doc: { ...before.doc, ...rest } });
      }
      const payload = await send(base, { method: "PATCH", body: JSON.stringify(slices) });
      if (payload) setWorld(payload as unknown as WorldState);
      else if (before) setWorld(before);
      return Boolean(payload);
    },
    [base, send],
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
