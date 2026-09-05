"use client";

import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { InfoButton } from "@/components/ui/InfoDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SRD_SKILLS } from "@/lib/srd";
import type { WorldPack } from "@/lib/worlds/types";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import type { BackgroundOption } from "../useBuilderOptions";
import type { BuilderState } from "../useBuilderState";
import { Field, StepPanel, inputClass } from "./shared";

const GENDERS = ["Female", "Male", "Nonbinary"];

export type BuilderRole = "pc" | "companion";

// Step 1: the name, who plays them, level, background and alignment. The
// setting notices live here too, so the first thing a player sees under a
// world pack is whose names they are about to choose from.
export function IdentityStep({
  state,
  pack,
  packInstalled,
  fixedLevel,
  role,
  alignmentOrder,
  backgroundGroups,
  background,
}: {
  state: BuilderState;
  pack: WorldPack | null;
  packInstalled: boolean;
  fixedLevel?: number;
  // Offered by the library page only: a campaign already knows which door
  // the character comes through.
  role?: { value: BuilderRole; onChange: (role: BuilderRole) => void };
  alignmentOrder: string[];
  backgroundGroups: PickerGroup[];
  background: BackgroundOption | undefined;
}) {
  return (
    <div className="space-y-4">
      {!packInstalled ? (
        <p className="rounded-lg border border-stone-700/60 bg-stone-900/60 p-3 text-xs text-stone-400">
          Content pack not installed; showing SRD 5.1 basics only. Run
          <span className="font-mono"> node scripts/import-open5e.mjs</span> on the server
          for the full Open5e catalog.
        </p>
      ) : null}
      {pack ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-xs text-amber-100">
            <span className="font-medium">{pack.name}</span> · {pack.blurb}
          </p>
          <p className="mt-1 text-[11px] text-stone-400">
            Names only. Every race, class, spell and item below plays by the same 5e rules.
          </p>
          <UnofficialPackNotice
            rightsHolder={pack.rightsHolder}
            inspiredBy={pack.inspiredBy}
            variant="inline"
            className="mt-1"
          />
        </div>
      ) : null}

      <StepPanel title="Name your hero" ornate>
        <input
          value={state.name}
          onChange={(event) => state.setName(event.target.value)}
          required
          maxLength={60}
          placeholder={pack?.nameHints || "Thornwick Ashvale"}
          className={inputClass}
          aria-label="Name"
        />
        {pack?.nameSeeds.people.length ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {pack.nameSeeds.people.slice(0, 8).map((seed) => (
              <button
                key={seed}
                type="button"
                onClick={() => state.setName(seed)}
                className="rounded-md border border-stone-700/70 px-1.5 py-0.5 text-[11px] text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-100"
              >
                {seed}
              </button>
            ))}
          </span>
        ) : null}
        {role ? (
          <div className="mt-4">
            <span className="mb-1.5 block text-xs text-stone-400">Their place at the table</span>
            <SegmentedControl
              label="Role"
              value={role.value}
              onChange={role.onChange}
              options={[
                { value: "pc", label: "A character I play" },
                { value: "companion", label: "An ally the DM plays" },
              ]}
              className="w-full"
            />
            <p className="mt-1.5 text-xs text-stone-500">
              {role.value === "companion"
                ? "Companions are offered when a party adds one, at whatever level that table plays at. Nobody has to roll them up again."
                : "Joins a campaign as yours to control."}
            </p>
          </div>
        ) : null}
      </StepPanel>

      <StepPanel title="Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Gender">
            <select
              value={state.gender}
              onChange={(event) => state.setGender(event.target.value)}
              className={inputClass}
            >
              <option value="">Unspecified</option>
              {GENDERS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Level">
            {fixedLevel ? (
              <span className="block rounded-lg border border-stone-700/70 bg-stone-950/60 px-3 py-2 text-sm text-stone-400">
                {fixedLevel} (campaign)
              </span>
            ) : (
              <select
                value={state.level}
                onChange={(event) => state.setLevel(Number(event.target.value))}
                className={inputClass}
              >
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Background">
            <OptionPicker
              value={background?.id ?? ""}
              groups={backgroundGroups}
              className={inputClass}
              onChange={state.setBackgroundId}
            />
            {background ? (
              <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
                <span className="grow">
                  {background.skills.length
                    ? `Grants ${background.skills.map((skillId) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId).join(", ")}`
                    : "What your character did before adventuring."}
                </span>
                <InfoButton
                  label={background.name}
                  text={background.blurb || background.desc}
                  reference={{ kind: "backgrounds", slug: background.id }}
                />
              </span>
            ) : null}
          </Field>
          <Field label="Alignment">
            <select
              value={state.alignment}
              onChange={(event) => state.setAlignment(event.target.value)}
              className={inputClass}
            >
              {alignmentOrder.map((value) => (
                <option key={value} value={value}>
                  {value}
                  {pack?.alignments.includes(value) ? " (fits this world)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </StepPanel>
    </div>
  );
}
