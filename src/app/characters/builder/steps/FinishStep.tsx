"use client";

import { Camera, UserRound } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { contentSlug } from "@/lib/help";
import type { Ability, CreateSheetInput } from "@/lib/schemas/sheet";
import { formatModifier, proficiencyBonus } from "@/lib/srd";
import { featAbilityIncrease } from "@/lib/srd/feat-effects";
import { srdRaceId } from "@/lib/srd/race-id";
import { ABILITY_LABELS } from "../AbilityEditor";
import { ui } from "@/lib/ui";
import CatalogBrowser from "../CatalogBrowser";
import ContentPicker from "../ContentPicker";
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
  // step). The one race that hands out a feat of its own is the variant
  // human; anyone else's extra feat is refused by the server.
  const racialFeat = race ? srdRaceId(race.id) === "variant_human" : false;
  const featRoom = racialFeat ? Math.max(0, 1 - state.feats.length) : 0;
  // A half-feat that offers a choice of score (Resilient, Athlete) asks
  // which one it raises; the server adds the point when the sheet is saved.
  const featScores = racialFeat ? (featAbilityIncrease(state.feats[0] ?? "")?.from ?? []) : [];
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

      {racialFeat || state.feats.length ? (
        <StepPanel
          title={racialFeat ? "Your feat" : "Feats"}
          help={
            racialFeat
              ? "A variant human starts with one feat of their choice."
              : "Feats this character already holds. New feats come with an ability score improvement."
          }
        >
          {featRoom ? (
            <>
              <ContentPicker
                kind="feats"
                placeholder="Search feats (e.g. alert, tough)"
                onPick={(entry) =>
                  state.setFeats((current) =>
                    current.includes(entry.name) || current.length >= 1 ? current : [...current, entry.name],
                  )
                }
              />
              {/* Feats are the pick a new player is least able to name, so the
                  whole list is one tap away with a ⓘ on every row. */}
              <CatalogBrowser
                kind="feats"
                buttonLabel="Browse every feat"
                selectedNames={state.feats}
                onPick={(entry) =>
                  state.setFeats((current) =>
                    current.includes(entry.name) || current.length >= 1 ? current : [...current, entry.name],
                  )
                }
                onUnpick={(featName) =>
                  state.setFeats((current) => current.filter((entry) => entry !== featName))
                }
                sections={[{ key: "feats:all", label: "All feats" }]}
              />
            </>
          ) : null}
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
          {featScores.length > 1 ? (
            <label className="mt-2 block sm:w-64">
              <span className="mb-1 block text-xs text-stone-500">{state.feats[0]} raises by 1</span>
              <Select<Ability>
                value={featScores.includes(state.racialFeatAbility as Ability) ? (state.racialFeatAbility as Ability) : featScores[0]}
                onChange={(ability) => state.setRacialFeatAbility(ability)}
                label={`${state.feats[0]} raises`}
                className="w-full"
                options={featScores.map((ability) => ({ value: ability, label: ABILITY_LABELS[ability] }))}
              />
            </label>
          ) : null}
        </StepPanel>
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
        <p className="motion-shake text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
