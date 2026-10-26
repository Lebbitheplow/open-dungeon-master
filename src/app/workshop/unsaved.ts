"use client";

import { useEffect, useRef } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";

// Editors with changes not saved yet (audit finding WF-21): switching tools
// or entries in the workshop remounts the editor and loses its draft, so
// the workshop asks first. Each open editor says whether its draft differs
// from what it opened with; leaving the page while one does gets the
// browser's own "leave this page?" as well. The browser's Back button is
// the one way out not asked about: the app router cannot hold it.
//
// An editor that saves itself (the Plugin tool) also hands over how to save
// now (WA-03). It used to register nothing, so a switch inside its autosave
// pause was waved through and the last edit went with the unmounted panel.
// Now leaving saves it first, and asks only when that save did not land.

type Draft = { flush?: () => Promise<boolean> };

const dirty = new Map<symbol, Draft>();

// How long leaving waits on a save before it asks instead.
export const FLUSH_WAIT_MS = 10_000;

function warnOnLeave(event: BeforeUnloadEvent) {
  event.preventDefault();
}

// One editor's unsaved draft, until the returned call takes it back. Apart
// from the hook so the rule can be checked without React.
export function registerDraft(entry: Draft): () => void {
  const key = Symbol("draft");
  dirty.set(key, entry);
  if (dirty.size === 1) window.addEventListener("beforeunload", warnOnLeave);
  return () => {
    dirty.delete(key);
    if (dirty.size === 0) window.removeEventListener("beforeunload", warnOnLeave);
  };
}

export function useUnsavedDraft(isDirty: boolean, flush?: () => Promise<boolean>) {
  // The latest flush, so a draft registered once saves what is on screen
  // when it is asked, not what was there when it registered.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  const saves = Boolean(flush);
  useEffect(() => {
    if (!isDirty) return;
    return registerDraft(saves ? { flush: () => flushRef.current?.() ?? Promise.resolve(false) } : {});
  }, [isDirty, saves]);
}

// A save that throws, or has not answered in time, counts as not saved.
function within(flush: () => Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const save = Promise.resolve()
    .then(flush)
    .catch(() => false);
  return Promise.race([save, late]).finally(() => clearTimeout(timer));
}

// Whether the workshop may move on: yes when nothing is unsaved, or when
// every editor that saves itself has saved, or when the author says to
// leave the changes behind.
export async function mayLeaveDrafts(waitMs = FLUSH_WAIT_MS): Promise<boolean> {
  const entries = [...dirty.values()];
  if (entries.length === 0) return true;
  const saved = await Promise.all(entries.map((entry) => (entry.flush ? within(entry.flush, waitMs) : Promise.resolve(false))));
  if (saved.every(Boolean)) return true;
  return appConfirm("An editor here has changes that are not saved. Leave them and go on?", {
    title: "Leave without saving?",
    actionLabel: "Leave them",
    tone: "danger",
  });
}
