"use client";

import { Camera, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { contentSlug } from "@/lib/help";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { formatModifier, proficiencyBonus } from "@/lib/srd";
import { racialFeatCount } from "@/lib/srd/race-id";
import { ui } from "@/lib/ui";
import { HpExplainerButton } from "../AbilityExplainers";
import { armorClassLine, hitPointsLine, purseViewFor } from "../derivedReasons";
import type { BackgroundOption, ClassOption, RaceOption } from "../useBuilderOptions";
import type { TableRulesState } from "../useTableRules";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { hpExplainerInput } from "./AbilitiesStep";
import { Chip, Field, StepPanel, inputClass } from "./shared";

// Step 6: the portrait, how they look, their story, extra feats, and the
// numbers the sheet will open with. The save button is the wizard footer.
export function FinishStep({
  state,
  derived,
  race,
  klass,
  background,
  table,
  initial,
  paintsPortraits,
  onUploadPortrait,
  error,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  table: TableRulesState;
  initial?: CreateSheetInput;
  // Whether this server can paint a portrait at all. Without an image
  // backend the section offers the upload alone and stops promising a
  // painting that would never arrive.
  paintsPortraits: boolean;
  onUploadPortrait: () => void;
  error: string;
}) {
  const { portrait, setPortrait } = state;
  const { preview, acInfo, ac, effectiveLevel } = derived;
  const keptSaved = Boolean(initial?.portrait && portrait?.url === initial.portrait.url);
  const hp = hpExplainerInput(state, derived, race, klass);
  // Hit points, armor class and coin are the server's to work out, so they
  // are shown with their reasons and never typed.
  const hpLine =
    preview && klass
      ? hitPointsLine({
          hitDie: klass.hitDie,
          level: effectiveLevel,
          maxHp: preview.maxHp,
          range: preview.hpRange,
          method: preview.hpMethod,
          kept: state.hpOverride !== null,
          atTable: Boolean(table.rules),
        })
      : null;
  const acLine = armorClassLine(acInfo?.ac ?? ac, acInfo?.parts);
  const purse = purseViewFor({
    purse: derived.purse,
    keepsStoredGear: state.keepsStoredGear,
    backgroundName: background?.name ?? "chosen",
    backgroundPurse: background?.purse ?? 0,
    classId: klass?.id ?? "",
    className: klass?.name ?? "character",
    table,
  });
  // Feats come with Ability Score Improvements (picked on the Abilities
  // step) or, for a variant human, with the race (picked on the Ancestry
  // step, issue #124). What is left here is what the character already
  // holds from play, shown so an edit does not lose it unseen.
  const racialFeat = race ? racialFeatCount(race.id) > 0 : false;
  return (
    <div className="space-y-4">
      <StepPanel title="Portrait (optional)" ornate>
        <div className="flex items-center gap-3">
          {portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portrait.url}
              alt="Character portrait"
              className="size-16 shrink-0 rounded-lg border border-amber-500/30 object-cover"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-stone-700/60 bg-stone-950 text-stone-600">
              <UserRound className="size-6" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* The upload is offered everywhere, whether or not a painter
                  exists: a photo is always a way to give a hero a face. */}
              <button type="button" onClick={onUploadPortrait} className={ui.btnSmall}>
                <Camera className="size-3.5" />
                {portrait ? "Replace photo" : "Upload a photo"}
              </button>
              {/* Clearing the saved portrait means "paint me a new one", which
                  only makes sense where a painter exists. A freshly uploaded
                  photo can always be taken back. */}
              {portrait && (paintsPortraits || !keptSaved) ? (
                <button type="button" onClick={() => setPortrait(null)} className={ui.btnSmall}>
                  {keptSaved ? "Regenerate portrait" : "Remove photo"}
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-stone-500">
              {portrait
                ? paintsPortraits
                  ? "This photo is used as-is; no portrait is painted for you."
                  : "This photo is used as-is."
                : paintsPortraits
                  ? "Add art, or let the AI paint one after you save."
                  : "Upload a photo to give your character a face."}
            </p>
          </div>
        </div>
        <Field label="Appearance" className="mt-4">
          <p className="mb-2 text-xs text-stone-500">
            {paintsPortraits
              ? "Used to paint your character's portrait if you don't upload a photo."
              : "How your character looks, for the party and the DM to picture."}
          </p>
          <textarea
            value={state.appearance}
            onChange={(event) => state.setAppearance(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Silver hair, weathered face, a scar across one eye..."
            className={cn(inputClass, "resize-y")}
          />
        </Field>
      </StepPanel>

      <StepPanel
        title="Backstory (optional)"
        help="Who were they before the adventure? The party can read this, and the DM weaves it into the story."
      >
        <textarea
          value={state.backstory}
          onChange={(event) => state.setBackstory(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="A disgraced temple guard looking for a second chance..."
          className={cn(inputClass, "resize-y")}
          aria-label="Backstory"
        />
      </StepPanel>

      {!racialFeat && state.feats.length ? (
        <StepPanel
          title="Feats"
          help="Feats this character already holds. New feats come with an ability score improvement."
        >
          <div className="mt-2 flex flex-wrap gap-1.5">
            {state.feats.map((feat) => (
              <Chip
                key={feat}
                label={feat}
                info={{ reference: { kind: "feats", slug: contentSlug(feat), name: feat } }}
                onRemove={() => state.setFeats((current) => current.filter((entry) => entry !== feat))}
              />
            ))}
          </div>
        </StepPanel>
      ) : null}

      {table.rulesError ? (
        <p role="alert" className="reveal flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
          {table.rulesError}
          <button type="button" onClick={table.retryRules} className={ui.btnSmall}>
            Try again
          </button>
        </p>
      ) : null}
      {preview && race ? (
        <StepPanel title="Derived stats" ornate className="border-amber-500/30">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-stone-300 sm:grid-cols-4">
            <Field
              label={
                <span className="flex items-center gap-0.5">
                  Max HP
                  {hp ? <HpExplainerButton hp={hp} compact /> : null}
                </span>
              }
            >
              <span key={hpLine?.value} className="reveal font-mono text-base text-amber-100">
                {hpLine?.value}
              </span>
              <span className="mt-1 block text-[11px] text-stone-500">{hpLine?.reason}</span>
            </Field>
            <Field label="AC">
              <span key={acLine.value} className="reveal font-mono text-base text-amber-100">
                {acLine.value}
              </span>
              <span className="mt-1 block text-[11px] text-stone-500">{acLine.reason}</span>
            </Field>
            <Field label="Gold" className="col-span-2">
              <span key={`${purse.gold}-${purse.copper}`} className="reveal font-mono text-base text-amber-100">
                {purse.gold} gp{purse.copper ? ` ${purse.copper} cp` : ""}
              </span>
              <span className="mt-1 block text-[11px] text-stone-500">
                {purse.wealth?.rolled
                  ? `Rolled by the server: ${purse.wealth.rolled.gold} gp on ${purse.wealth.dice}. `
                  : ""}
                {purse.source}
              </span>
            </Field>
            <span className="self-end">Speed {race.speed} ft</span>
            <span className="self-end">Prof {formatModifier(proficiencyBonus(effectiveLevel))}</span>
            <span>Initiative {formatModifier(preview.derived.initiative)}</span>
            <span>Passive Perception {preview.derived.passivePerception}</span>
            {preview.derived.spellSaveDc ? <span>Spell DC {preview.derived.spellSaveDc}</span> : null}
            {preview.derived.spellAttack !== null ? (
              <span>Spell attack {formatModifier(preview.derived.spellAttack)}</span>
            ) : null}
          </div>
        </StepPanel>
      ) : null}

      {error ? (
        // Every reason the server gave, not just the first (U:UB8).
        error.includes("\n") ? (
          <div className="motion-shake text-sm text-red-400" role="alert">
            <p>The server did not save the character:</p>
            <ul className="stagger mt-1 list-disc space-y-0.5 pl-5">
              {error.split("\n").map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="motion-shake text-sm text-red-400" role="alert">
            {error}
          </p>
        )
      ) : null}
    </div>
  );
}
