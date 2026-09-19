"use client";

import { Dices, Loader2, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CampaignMember } from "@/lib/campaign-types";
import { cn } from "@/lib/cn";
import { OptionalStepper } from "@/app/workshop/kit";
import { expressionDice } from "@/lib/dice";
import { buzz, onShake, supportsShake, useShakeToRoll } from "@/lib/dice/shake-to-roll";
import {
  resolveFaceSource,
  useDiceSources,
  type FaceSource,
} from "@/lib/dice/dice-sources";
import {
  getConnectedPixels,
  getConnectedPixelsServer,
  onPixelRoll,
  onPixelsChanged,
} from "@/lib/dice/pixels-dice";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { CheckDie, CheckFrame, ModifierBreakdown } from "@/app/campaigns/[campaignId]/SkillCheckCard";
import { findSkill } from "@/lib/srd";

const KIND_TITLES: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack roll",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

const ABILITY_NAMES: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const OWNER_FALLBACK_AFTER_MS = 3 * 60 * 1000;

const SUBMIT_BUTTON = cn(
  "motion-press rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-950",
  "shadow-[0_1px_0_rgba(253,247,231,0.6)_inset] transition-all duration-150 ease-snap",
  "hover:-translate-y-px hover:shadow-glow-gold-strong active:translate-y-0 active:scale-95",
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none",
);

// A parked roll. For a physical-dice player the roller enters each die; for
// a player who holds their own rolls (shake to roll) the card waits for a
// shake or a tap and the server rolls. Everyone else sees a waiting card.
// The roller can always fall back to a digital roll; the owner can too once
// the card has sat unanswered for a few minutes.
//
// The presentation is the violet skill-check card (SkillCheckCard.tsx,
// docs/visual-overhaul-plan.md 5.4): the halo breathes while the roll is
// parked, the die tumbles once it has been sent, and the landing itself
// plays where the roll arrives, in the chronicle (RollCard.tsx). Every
// source and control is as it was.
export function PendingRollCard({
  campaignId,
  pending,
  sheets,
  members,
  meUserId,
  steersStory,
}: {
  campaignId: string;
  pending: PendingRoll;
  sheets: CharacterSheet[];
  members: CampaignMember[];
  meUserId: string;
  steersStory: boolean;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Sampled once on mount; the fallback affordance appearing on the next
  // re-render after the threshold is fine for a courtesy button.
  const [mountedAt] = useState(() => Date.now());

  const faces = useMemo(() => {
    try {
      return expressionDice(pending.expression);
    } catch {
      return [];
    }
  }, [pending.expression]);

  const mine = pending.userId === meUserId;
  // Held without real dice: no faces to type, the whole roll is digital
  // and released by the roller (a shake here, a tap anywhere).
  const roller = members.find((member) => member.userId === pending.userId);
  const heldOnly = Boolean(roller?.holdRolls && !roller?.useRealDice);
  const shakeOn = useShakeToRoll();
  const [canShake] = useState(() => supportsShake());
  const shakeActive = mine && shakeOn && canShake;

  const [diceSources] = useDiceSources();
  const pixels = useSyncExternalStore(
    onPixelsChanged,
    getConnectedPixels,
    getConnectedPixelsServer,
  );

  // Resolve every face to its source: the chosen preference, degraded to
  // typing when the assigned Pixels die isn't currently connected.
  const faceSources = useMemo<FaceSource[]>(
    () => faces.map((sides) => resolveFaceSource(diceSources[sides], sides, pixels)),
    [faces, diceSources, pixels],
  );

  // What a face has so far: the typed or Pixels-landed entry, else empty. A
  // digital face never has a client value; the server rolls it on submit, so
  // the browser has nothing a player could read ahead of time.
  const faceValue = (index: number): string => values[index]?.trim() ?? "";

  // The wire payload: numbers for typed and Pixels faces, the literal
  // "digital" for server-rolled ones.
  const submissionDice = (): Array<number | "digital"> =>
    faces.map((_, index) =>
      faceSources[index]?.kind === "digital" ? "digital" : Number(faceValue(index)),
    );

  // A physical Pixels die landing fills the next empty face assigned to it.
  useEffect(() => {
    if (!mine) {
      return;
    }
    return onPixelRoll(({ systemId, faceCount, value }) => {
      setValues((current) => {
        const index = faceSources.findIndex(
          (source, position) =>
            source.kind === "pixel" &&
            source.systemId === systemId &&
            faces[position] === faceCount &&
            !current[position]?.trim(),
        );
        if (index < 0) {
          return current;
        }
        return { ...current, [index]: String(value) };
      });
    });
  }, [mine, faceSources, faces]);

  const character = sheets.find((sheet) => sheet.id === pending.characterId);
  // Attack-engine pendings already carry a full sentence in detail
  // ("Kara: Longsword vs Goblin"); avoid stacking the name twice.
  const detailText = pending.detail.replaceAll("_", " ");
  const label = detailText.startsWith(`${character?.name ?? ""}:`)
    ? detailText
    : `${character?.name ?? "Someone"}: ${pending.kind.replaceAll("_", " ")}${
        detailText ? ` (${detailText})` : ""
      }`;
  // Plain-words instruction: "Roll 2× d20 and 1× d8" from the faces list.
  const diceSummary = (() => {
    if (!faces.length) {
      return "";
    }
    const counts = new Map<number, number>();
    for (const sides of faces) {
      counts.set(sides, (counts.get(sides) ?? 0) + 1);
    }
    const parts = [...counts.entries()].map(
      ([sides, count]) => `${count} × d${sides}`,
    );
    return parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      : parts[0];
  })();
  // Enter raw die faces only; any flat bonus applies server-side.
  const flatModifier = /([+-]\d+)$/.exec(pending.expression.replaceAll(" ", ""))?.[1];
  const modifierNote = flatModifier
    ? `Enter the bare die numbers; the ${flatModifier} is added for you.`
    : "";
  const advantageNote =
    pending.advantage === "advantage"
      ? "advantage: roll both, highest counts"
      : pending.advantage === "disadvantage"
        ? "disadvantage: roll both, lowest counts"
        : "";
  const stale = mountedAt - new Date(pending.createdAt).getTime() > OWNER_FALLBACK_AFTER_MS;
  // A digital face is always ready (the server fills it); everything else
  // needs its number in hand before the roll can go.
  const complete =
    faces.length > 0 &&
    faces.every(
      (_, index) => faceSources[index]?.kind === "digital" || faceValue(index),
    );
  // Every face comes from a die that fills itself (digital or a Pixels die):
  // no typing is needed, so the card submits on its own once all have landed.
  const fullyAutomatic =
    faceSources.length > 0 && faceSources.every((source) => source.kind !== "manual");

  async function submit(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/pending-rolls/${pending.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not submit the roll.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    // A held roll is the player's to release: never auto-submit it, even
    // when every die source is digital.
    if (!mine || heldOnly || !fullyAutomatic || autoSubmittedRef.current || busy || !complete) {
      return;
    }
    autoSubmittedRef.current = true;
    void submit({ dice: submissionDice() });
    // submit is stable enough for this one-shot guarded call; re-running only
    // matters to catch the transition to complete, which the deps below cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, heldOnly, fullyAutomatic, busy, complete, faces, values]);

  // A shake releases the roll: the typed and Pixels faces when they are all
  // in, otherwise a fully digital roll. One shake per card.
  const shakenRef = useRef(false);
  useEffect(() => {
    if (!shakeActive || busy) {
      return;
    }
    return onShake(() => {
      if (shakenRef.current) return;
      shakenRef.current = true;
      buzz();
      void submit(!heldOnly && complete ? { dice: submissionDice() } : { fallback: "digital" });
    });
    // submit and submissionDice read the latest values through closure;
    // the listener is rebound whenever the inputs it depends on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeActive, busy, heldOnly, complete, faces, values]);

  async function stopHolding() {
    await fetch(`/api/campaigns/${campaignId}/members/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holdRolls: false }),
    }).catch(() => undefined);
  }

  // What the card is about, for its head: the kind, the DC the table was
  // sent, and the ability behind a skill ("Athletics" is Strength).
  const title = KIND_TITLES[pending.kind] ?? "Roll";
  const skillId = pending.detail.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const abilityId =
    pending.kind === "skill_check"
      ? findSkill(skillId)?.ability
      : pending.kind === "saving_throw" || pending.kind === "ability_check"
        ? skillId.slice(0, 3)
        : undefined;
  const abilityName = abilityId ? ABILITY_NAMES[abilityId] : undefined;

  if (!mine) {
    return (
      <CheckFrame className="mb-2 flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <CheckDie state="waiting" sides={faces[0] ?? 20} size="size-7" />
          <span className="min-w-0">
            Waiting for {character?.name ?? "a player"} to roll {pending.expression}
            {heldOnly ? "" : " with real dice"}
          </span>
        </span>
        {steersStory && stale ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ fallback: "digital" })}
            className="motion-press shrink-0 font-medium underline decoration-dotted underline-offset-2 disabled:opacity-50"
          >
            Roll digitally
          </button>
        ) : null}
      </CheckFrame>
    );
  }

  return (
    <CheckFrame className="mb-2 animate-fade-up px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-3">
        {/* The die: resting under its halo, tumbling once the roll is sent. */}
        <CheckDie state={busy ? "waiting" : "idle"} sides={faces[0] ?? 20} halo={!busy} />
        <div className="min-w-0 flex-1 basis-52">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="check-well px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em]">
              {title}
            </span>
            {pending.dc !== null ? (
              <span className="check-well check-dim px-2 py-0.5 font-mono text-[11px]">Difficulty Class: {pending.dc}</span>
            ) : null}
            <ModifierBreakdown expression={pending.expression} caption={abilityName} />
          </div>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <Dices className="size-4 shrink-0" style={{ color: "var(--check-vine)" }} />
            <span className="min-w-0">Your roll: {label}</span>
          </p>
          {pending.reason ? <p className="check-dim mt-0.5 text-xs">{pending.reason}</p> : null}
      {heldOnly ? (
        <>
          {advantageNote ? (
            <p className="check-dim mt-0.5 text-xs">{advantageNote}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {shakeActive ? (
              <span className="flex items-center gap-2 text-sm">
                <Smartphone className="size-5 animate-bounce" style={{ color: "var(--check-vine)" }} />
                Shake to roll {diceSummary}
              </span>
            ) : (
              <span className="text-xs">
                Your rolls wait for you{canShake ? "" : " (shake to roll is on on your phone)"}.
              </span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => submit({ fallback: "digital" })}
              className={SUBMIT_BUTTON}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Roll now"}
            </button>
            {!shakeActive ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void stopHolding()}
                className="check-dim text-xs hover:underline disabled:opacity-50"
              >
                Stop holding my rolls
              </button>
            ) : null}
          </div>
          {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
        </>
      ) : null}
      {!heldOnly && diceSummary ? (
        <p className="mt-1 text-xs">
          {fullyAutomatic
            ? `Roll ${diceSummary}. Your assigned dice fill in on their own.`
            : `Roll ${diceSummary} at your table and enter each die below.${
                modifierNote ? ` ${modifierNote}` : ""
              } The game waits for your result.`}
        </p>
      ) : null}
      {!heldOnly && advantageNote ? (
        <p className="check-dim mt-0.5 text-xs">{advantageNote}</p>
      ) : null}
      {!heldOnly && shakeActive ? (
        <p className="check-dim mt-0.5 flex items-center gap-1.5 text-xs">
          <Smartphone className="size-3.5" /> Or shake to roll it digitally.
        </p>
      ) : null}

      {heldOnly ? null : (
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {faces.map((sides, index) => {
          const source = faceSources[index] ?? { kind: "manual" };
          const filled = faceValue(index);
          // Digital faces are rolled by the server on submit: marked, not
          // typed, and showing no number the player could act on early.
          if (source.kind === "digital") {
            return (
              <div key={index} className="block">
                <span className="mb-0.5 block text-center text-[10px] text-sky-300/80">
                  d{sides} · auto
                </span>
                <div
                  aria-label={`d${sides} rolled for you`}
                  className="flex h-[34px] w-14 items-center justify-center rounded-md border border-sky-800/70 bg-sky-950/30 text-sm text-sky-100"
                >
                  <Dices className="size-4 text-sky-300/80" />
                </div>
              </div>
            );
          }
          // Pixels faces auto-fill when the die lands, but stay editable so a
          // stubborn die never blocks the roll.
          const isPixel = source.kind === "pixel";
          return (
            <div key={index} className="block">
              <span
                title={isPixel ? source.name : undefined}
                className={cn(
                  "mb-0.5 block max-w-24 truncate text-center text-[10px]",
                  isPixel ? "text-sky-300/90" : "check-dim",
                )}
              >
                {isPixel ? source.name : `d${sides}`}
              </span>
              <div className="relative">
                {/* Blank means "not rolled yet", so the stepper is the optional
                    one: the cross clears a mistyped die back to blank. */}
                <OptionalStepper
                  min={1}
                  max={sides}
                  fallback={1}
                  value={filled === "" || !Number.isFinite(Number(filled)) ? undefined : Number(filled)}
                  onChange={(next) => setValues((current) => ({ ...current, [index]: next === "" ? "" : String(next) }))}
                  label={isPixel ? `${source.name}, d${sides}` : `d${sides}`}
                  size="sm"
                />
                {isPixel && !filled ? (
                  <Dices className="pointer-events-none absolute -right-1 -top-1 size-3 animate-pulse text-sky-400/70" />
                ) : null}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          disabled={busy || !complete}
          onClick={() => submit({ dice: submissionDice() })}
          className={SUBMIT_BUTTON}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Submit roll"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit({ fallback: "digital" })}
          className="check-dim text-xs hover:underline disabled:opacity-50"
        >
          Roll digitally instead
        </button>
      </div>
      )}
      {!heldOnly && error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
        </div>
      </div>
    </CheckFrame>
  );
}
