"use client";

import { Loader2, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Sheet } from "@/components/ui/Sheet";
import { PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { cn } from "@/lib/cn";
import { readLoad, readWrite } from "@/lib/load-state";
import { navigateTo } from "@/lib/navigation";
import { ui } from "@/lib/ui";
import { TARGET_PARTY_LIMITS } from "@/lib/workshop/kind";
import type { PreparedEncounter } from "@/app/workshop/encounters/types";

// Test fight (issue 553): who fights the prepared fight, then the table
// (src/lib/workshop/test-fight.ts). Each question has a default that needs
// no answer. The stand-ins are the party the workshop is built for, so one
// press tests what every budget in the workshop was measured against; the
// other answer is the author's own characters, when the question is how
// their party fares. Where an AI DM is set up it runs the fight unless the
// author would rather run it, as they run their own tables; where none is,
// the author runs it and the sheet only says so.

export type TestFightInfo = {
  ready: boolean;
  reason: string;
  standIns: { size: number; level: number; classes: string[] };
  open: { id: string; title: string; createdAt: string } | null;
};

type Character = {
  id: string;
  name: string;
  role: "pc" | "companion";
  race: string;
  class: string;
  level: number;
};

type Who = "stand-ins" | "characters";

function describe(character: Character): string {
  return `Level ${character.level} ${[character.race, character.class].filter(Boolean).join(" ")}`;
}

function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const choiceCard =
  "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-amber-400/40";

export function TestFightSheet({
  workshopId,
  encounter,
  info,
  onClose,
}: {
  workshopId: string;
  // The fight to test; null keeps the sheet shut.
  encounter: PreparedEncounter | null;
  info: TestFightInfo | null;
  onClose: () => void;
}) {
  const [who, setWho] = useState<Who>("stand-ins");
  const [runner, setRunner] = useState<"ai" | "person">("ai");
  const [picked, setPicked] = useState<string[]>([]);
  const [pregens, setPregens] = useState<Character[] | null>(null);
  const [library, setLibrary] = useState<Character[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = encounter !== null;

  // The characters are read when the sheet opens, the roster first: the
  // pregens are the ones made for this workshop.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      readLoad<{ pregens?: Character[] }>(fetch(`/api/workshops/${workshopId}/pregens`), "The roster"),
      readLoad<{ characters?: Character[] }>(fetch("/api/characters"), "Your characters"),
    ]).then(([roster, shelf]) => {
      if (cancelled) return;
      setLoadError(roster.error ?? shelf.error ?? "");
      setPregens((roster.payload?.pregens ?? []).filter((character) => character.role !== "companion"));
      setLibrary((shelf.payload?.characters ?? []).filter((character) => character.role !== "companion"));
    });
    return () => {
      cancelled = true;
    };
  }, [open, workshopId]);

  function close(next: boolean) {
    if (next) return;
    setError("");
    setBusy(false);
    onClose();
  }

  function toggle(id: string, on: boolean) {
    setPicked((current) => (on ? [...current.filter((entry) => entry !== id), id] : current.filter((entry) => entry !== id)));
  }

  async function start() {
    if (!encounter) return;
    setBusy(true);
    setError("");
    const sent = await readWrite<{ campaignId: string }>(
      fetch(`/api/workshops/${workshopId}/test-fight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: encounter.id,
          party: who === "stand-ins" ? { kind: "stand-ins" } : { kind: "characters", characterIds: picked },
          runner: info?.ready ? runner : "person",
        }),
      }),
      "The test fight could not be set up.",
    );
    if (sent.error !== null) {
      setError(
        sent.unanswered
          ? `${sent.error} The table may have been made all the same: look under Encounters for the open test before starting another.`
          : sent.error,
      );
      setBusy(false);
      return;
    }
    navigateTo(`/campaigns/${sent.payload.campaignId}`);
  }

  const pregenIds = new Set((pregens ?? []).map((character) => character.id));
  const others = (library ?? []).filter((character) => !pregenIds.has(character.id));
  const full = picked.length >= TARGET_PARTY_LIMITS.size.max;
  const standIns = info?.standIns;
  const canStart = Boolean(info) && !busy && (who === "stand-ins" || picked.length > 0);

  const checkbox = (character: Character) => {
    const on = picked.includes(character.id);
    return (
      <li key={character.id}>
        <label className={cn(choiceCard, on ? "border-amber-500/50 bg-amber-500/10" : "border-stone-800 bg-stone-950/40")} data-test-pick={character.id}>
          <input
            type="checkbox"
            checked={on}
            disabled={!on && full}
            onChange={(event) => toggle(character.id, event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-amber-500"
          />
          <span className="min-w-0">
            <span className="block text-sm text-stone-100">{character.name}</span>
            <span className="block text-xs text-stone-400">{describe(character)}</span>
          </span>
        </label>
      </li>
    );
  };

  // One answer of a question, as a card the whole of which is its label.
  const radio = (group: string, checked: boolean, onSelect: () => void, title: string, hint: string) => (
    <label className={cn(choiceCard, checked ? "border-amber-500/50 bg-amber-500/10" : "border-stone-800 bg-stone-950/40")}>
      <input type="radio" name={group} checked={checked} onChange={onSelect} className="mt-0.5 size-4 shrink-0 accent-amber-500" />
      <span className="min-w-0">
        <span className="block text-sm text-stone-100">{title}</span>
        <span className="block text-xs text-stone-400">{hint}</span>
      </span>
    </label>
  );
  const legend = "mb-1.5 font-display text-xs uppercase tracking-[0.14em] text-amber-200/90";

  return (
    <Sheet open={open} onOpenChange={close} title={encounter ? `Test ${encounter.name}` : "Test fight"} className="lg:w-[min(92vw,34rem)]">
      <div className="space-y-4" data-testid="test-fight-sheet">
        <p className="text-sm text-stone-300">
          Play this fight on a table only you can see, on its map and by its plan. You play the
          party, each hero on their own turn.
        </p>

        <fieldset className="space-y-2">
          <legend className={legend}>Who fights it</legend>
          {radio(
            "test-fight-party",
            who === "stand-ins",
            () => setWho("stand-ins"),
            "The stand-in party",
            standIns
              ? `${standIns.size} ${standIns.size === 1 ? "hero" : "heroes"} at level ${standIns.level}, the party this workshop is built for: ${listed(standIns.classes)}. Built by the rules when the test starts.`
              : "The party this workshop is built for, built by the rules when the test starts.",
          )}
          {radio(
            "test-fight-party",
            who === "characters",
            () => setWho("characters"),
            "Characters you pick",
            "This workshop's pregens or anyone in your library, at their own levels. They fight as copies: nothing in the test reaches your library.",
          )}
        </fieldset>

        {who === "characters" ? (
          <div className="reveal space-y-3" aria-live="polite">
            {pregens === null || library === null ? (
              <p className="flex items-center gap-2 text-xs text-stone-400">
                <Loader2 className="size-3.5 animate-spin" /> Reading your characters...
              </p>
            ) : pregens.length + others.length === 0 ? (
              <p className="text-xs text-stone-400">
                You have no characters yet. Build one from the Party tool, or test with the stand-ins.
              </p>
            ) : (
              <>
                {pregens.length ? (
                  <section>
                    <h4 className="mb-1.5 text-xs text-stone-400">This workshop&apos;s pregens</h4>
                    <ul className="grid gap-1.5 sm:grid-cols-2">{pregens.map(checkbox)}</ul>
                  </section>
                ) : null}
                {others.length ? (
                  <section>
                    <h4 className="mb-1.5 text-xs text-stone-400">Your library</h4>
                    <ul className="grid gap-1.5 sm:grid-cols-2">{others.map(checkbox)}</ul>
                  </section>
                ) : null}
                <p className="text-xs text-stone-500">
                  {picked.length
                    ? `${picked.length} picked${full ? `, the most a test party holds` : ""}.`
                    : `Pick up to ${TARGET_PARTY_LIMITS.size.max}.`}
                </p>
              </>
            )}
            {loadError ? <PanelError>{loadError}</PanelError> : null}
          </div>
        ) : null}

        {/* Who runs it is a question only where an AI DM could; with none,
            the author does, and the note says so. */}
        {info?.ready ? (
          <fieldset className="space-y-2">
            <legend className={legend}>Who runs it</legend>
            {radio(
              "test-fight-runner",
              runner === "ai",
              () => setRunner("ai"),
              "The AI DM",
              "It opens the fight and runs the enemies by their plan, as at a table the AI runs.",
            )}
            {radio(
              "test-fight-runner",
              runner === "person",
              () => setRunner("person"),
              "You",
              "You run the enemies with their cards and the party with theirs, as a DM at a table you run. No AI is called.",
            )}
          </fieldset>
        ) : info ? (
          <p className="flex items-start gap-2 rounded-lg border border-stone-700/60 bg-stone-950/40 px-3 py-2 text-xs text-stone-300" data-testid="test-fight-not-ready">
            <GameIcon icon={{ kind: "glyph", key: "ui-ai" }} size="size-5" className="shrink-0" />
            {info.reason}
          </p>
        ) : null}
        {info?.open ? (
          <p className="text-xs text-stone-400">Starting this ends the test already open, {info.open.title}.</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!canStart} aria-busy={busy} onClick={() => void start()} className={cn(ui.btnPrimary, "min-h-11")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />}
            {busy ? "Setting the table..." : "Start the test fight"}
          </button>
        </div>
        {error ? <PanelError>{error}</PanelError> : null}
      </div>
    </Sheet>
  );
}
