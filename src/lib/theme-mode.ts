"use client";

import { useEffect, useSyncExternalStore } from "react";

// The light theme and the interface scale (docs/vtt-parity-implementation-plan.md
// section 14). Both are the reader's own: they live in localStorage, follow
// the OS by default, and are applied to <html> so every token below reads
// them. The board and its canvases size themselves in pixels and ignore the
// scale on purpose.

export type ThemeChoice = "auto" | "dark" | "light";
export type ThemeMode = "dark" | "light";

const THEME_KEY = "odm.theme";
const SCALE_KEY = "odm.ui-scale";
export const UI_SCALE_MIN = 0.9;
export const UI_SCALE_MAX = 1.25;

const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) {
    listener();
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  media?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", listener);
  };
}

export function readThemeChoice(): ThemeChoice {
  if (typeof window === "undefined") {
    return "auto";
  }
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "dark" || stored === "light" ? stored : "auto";
}

export function resolveTheme(choice: ThemeChoice): ThemeMode {
  if (choice !== "auto") {
    return choice;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function writeThemeChoice(choice: ThemeChoice) {
  if (choice === "auto") {
    window.localStorage.removeItem(THEME_KEY);
  } else {
    window.localStorage.setItem(THEME_KEY, choice);
  }
  applyTheme();
  emit();
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value)) * 100) / 100;
}

export function readUiScale(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  return clampScale(Number(window.localStorage.getItem(SCALE_KEY)) || 1);
}

export function writeUiScale(scale: number) {
  const clamped = clampScale(scale);
  if (clamped === 1) {
    window.localStorage.removeItem(SCALE_KEY);
  } else {
    window.localStorage.setItem(SCALE_KEY, String(clamped));
  }
  applyTheme();
  emit();
}

// Writes the choice onto <html>: data-theme for the token set, the scale
// as a root variable and as the root font size so every rem follows it.
export function applyTheme() {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const mode = resolveTheme(readThemeChoice());
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  const scale = readUiScale();
  root.style.setProperty("--ui-scale", String(scale));
  root.style.fontSize = scale === 1 ? "" : `${scale * 100}%`;
}

const SERVER_SNAPSHOT = { choice: "auto" as ThemeChoice, mode: "dark" as ThemeMode, scale: 1 };

export function useThemePrefs(): { choice: ThemeChoice; mode: ThemeMode; scale: number } {
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => SERVER_SNAPSHOT.choice);
  const scale = useSyncExternalStore(subscribe, readUiScale, () => SERVER_SNAPSHOT.scale);
  const mode = useSyncExternalStore(subscribe, () => resolveTheme(readThemeChoice()), () => SERVER_SNAPSHOT.mode);
  return { choice, mode, scale };
}

// Mounted once in the root layout: applies the stored choice before the
// first paint settles and again whenever the OS preference moves.
export function ThemeApplier() {
  useEffect(() => {
    applyTheme();
    return subscribe(applyTheme);
  }, []);
  return null;
}
