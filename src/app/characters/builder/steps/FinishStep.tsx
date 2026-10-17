"use client";

import { Camera, UserRound } from "lucide-react";
import { useId } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/cn";
import { contentSlug } from "@/lib/help";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { formatModifier, proficiencyBonus } from "@/lib/srd";
import { racialFeatCount } from "@/lib/srd/race-id";
import { ui } from "@/lib/ui";
import { HpExplainerButton } from "../AbilityExplainers";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { armorClassLine, hitPointsLine, purseViewFor } from "../derivedReasons";
import type { BackgroundOption, ClassOption, RaceOption } from "../useBuilderOptions";
import type { TableRulesState } from "../useTableRules";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { hpExplainerInput } from "./AbilitiesStep";
import { Chip, Field, StepPanel, inputClass } from "./shared";

export type BuilderRole = "pc" | "companion";

// Step 6: the hero at a glance with a way back to each choice, the numbers
// the sheet will open with, who plays them (library only), their alignment, the portrait, how they
// look, their story and extra feats. The save button is
// the wizard footer.
export type FinishEditStep = "identity" | "ancestry" | "calling" | "abilities" | "spells-gear";
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
  onEdit,
  alignmentGroups,
  alignmentInfo,
  role,
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
  // Back to the step that holds a choice ("identity", "calling"...).
  onEdit?: (step: FinishEditStep) => void;
  alignmentGroups: PickerGroup[];
  alignmentInfo: string;
  // Offered by the library page only, and only when the link that opened
  // it did not say (door.ts): a campaign already knows which door the
  // character comes through. It starts on a player character and is asked
  // here, at the end, because it changes nothing on the sheet.
  role?: { value: BuilderRole; onChange: (role: BuilderRole) => void };
}) {
  const { portrait, setPortrait } = state;
  const appearanceId = useId();
  const alignmentId = useId();
  const { preview, acInfo, ac, effectiveLevel } = derived;
  const keptSaved = Boolean(initial?.portrait && portrait?.url === initial.portrait.url);
  const hp = hpExplainerInput(derived, klass);
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
          kept: preview.hpKept,
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
  // The playable character leads: who they are with a way back to each
  // choice, then the numbers the sheet opens with. Portrait, looks and
  // story are the finishing touches beneath.
  const edits: Array<{ step: FinishEditStep; label: string; value: string }> = [
    { step: "identity", label: "Name and background", value: [state.name.trim() || "Unnamed", background?.name].filter(Boolean).join(" · ") },
    { step: "ancestry", label: "Ancestry", value: race?.name ?? "Not chosen" },
    { step: "calling", label: "Class", value: klass ? `${klass.name}${state.subclass ? ` (${state.subclass})` : ""}, level ${effectiveLevel}` : "Not chosen" },
    { step: "abilities", label: "Ability scores", value: preview ? "Set" : "Not set" },
    { step: "spells-gear", label: derived.casts ? "Spells and gear" : "Gear", value: derived.casts ? "Chosen" : "Packed" },
  ];
  return (
    <div className="space-y-4">
      <StepPanel title="Your hero" ornate className="border-amber-500/30">
        <ul className="divide-y divide-stone-800/70 text-sm" data-finish-summary>
          {edits.map((entry) => (
            <li key={entry.step} className="flex items-center gap-3 py-1.5">
              <span className="w-32 shrink-0 text-xs text-stone-500">{entry.label}</span>
              <span className="min-w-0 flex-1 truncate text-stone-200">{entry.value}</span>
              {onEdit ? (
                <button type="button" onClick={() => onEdit(entry.step)} className={cn(ui.btnSmall, "shrink-0 px-2 py-0.5 text-xs")}>
                  Edit
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </StepPanel>

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

      {role ? (
        <StepPanel title="Their place at the table" help="It changes nothing on the sheet, only how they join a campaign.">
          <SegmentedControl
            label="Their place at the table"
            value={role.value}
            onChange={role.onChange}
            options={[
              { value: "pc", label: "A character I play" },
              { value: "companion", label: "An ally the DM plays" },
            ]}
            className="w-full sm:max-w-md"
          />
          <p className="mt-1.5 text-xs text-stone-500">
            {role.value === "companion"
              ? "Companions are offered when a party adds one, at whatever level that table plays at. Nobody has to roll them up again."
              : "Joins a campaign as yours to control."}
          </p>
        </StepPanel>
      ) : null}

      <StepPanel
        title={
          <span className="inline-flex items-center gap-1">
            <span id={alignmentId}>Alignment</span>
            <InfoButton label="Alignment" text={alignmentInfo} />
          </span>
        }
        help="How they tend to act. It changes no number on the sheet."
      >
        <div className="sm:max-w-sm">
          <OptionPicker value={state.alignment} groups={alignmentGroups} labelledBy={alignmentId} className={inputClass} onChange={state.setAlignment} />
        </div>
      </StepPanel>

      <StepPanel title="Portrait (optional)" ornate>
        <div className="flex items-center gap-3">
          {portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portrait.url}
              // Named for the hero, as the roster names it.
              alt={state.name.trim() || "Your hero's portrait"}
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
        <Field label="Appearance" className="mt-4" captionId={appearanceId}>
          <p id={`${appearanceId}-help`} className="mb-2 text-xs text-stone-500">
            {paintsPortraits
              ? "Used to paint your character's portrait if you don't upload a photo."
              : "How your character looks, for the party and the DM to picture."}
          </p>
          <textarea
            value={state.appearance}
            onChange={(event) => state.setAppearance(event.target.value)}
            aria-labelledby={appearanceId}
            aria-describedby={`${appearanceId}-help`}
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
