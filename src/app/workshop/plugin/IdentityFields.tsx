"use client";

import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { ui } from "@/lib/ui";
import { GENRE_OPTIONS, RACE_OPTIONS, ALIGNMENT_OPTIONS, catalogLabel } from "@/lib/worlds/catalog";
import type { WorldPackDraft } from "@/lib/worlds/draft";
import { DM_FLAVOR_FLOOR } from "@/lib/worlds/draft-check";
import { ChipList, TextField } from "@/app/workshop/plugin/fields";
import type { SectionProps } from "@/app/workshop/plugin/types";

// The identity of a world pack, in four groups that are also the wizard's
// steps: what it is called, whose setting it stands on, what kind of world
// it is, and how the narrator should sound. The Identity tab shows all four
// at once for anyone past the guided setup.

export function NameFields({ draft, onDraft }: SectionProps) {
  const set = (patch: Partial<WorldPackDraft>) => onDraft({ ...draft, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        label="Name"
        value={draft.name}
        onChange={(name) => set({ name })}
        maxLength={70}
        placeholder="The Sunken Coast"
        className="sm:col-span-2"
        required
      />
      <TextField
        label="One line about it"
        value={draft.blurb}
        onChange={(blurb) => set({ blurb })}
        maxLength={200}
        placeholder="A drowned dwarven kingdom and the tide-cults that kept living in it."
        hint="What the picker shows under the name."
        className="sm:col-span-2"
        required
      />
      <TextField label="Author" value={draft.author} onChange={(author) => set({ author })} maxLength={80} />
      <TextField
        label="Version"
        value={draft.version}
        onChange={(version) => set({ version })}
        maxLength={20}
        hint="Bump it when you change the pack; servers offer an update when the number differs."
      />
      <TextField
        label="Homepage (optional)"
        value={draft.homepage}
        onChange={(homepage) => set({ homepage })}
        maxLength={300}
        placeholder="https://"
        className="sm:col-span-2"
      />
    </div>
  );
}

export function OriginFields({ draft, onDraft }: SectionProps) {
  const set = (patch: Partial<WorldPackDraft>) => onDraft({ ...draft, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        label="Inspired by"
        value={draft.inspiredBy}
        onChange={(inspiredBy) => set({ inspiredBy })}
        maxLength={200}
        placeholder="An original world, or the setting this is a homage to"
        className="sm:col-span-2"
        required
      />
      <TextField
        label="Rights holder"
        value={draft.rightsHolder}
        onChange={(rightsHolder) => set({ rightsHolder })}
        maxLength={120}
        placeholder="Leave empty if this is your own world"
        hint="Who owns the setting you are referencing. Filling it in turns the notice below into a proper non-affiliation disclaimer."
        className="sm:col-span-2"
      />
      <UnofficialPackNotice
        rightsHolder={draft.rightsHolder}
        inspiredBy={draft.inspiredBy.trim() || undefined}
        className="sm:col-span-2"
      />
      <TextField
        label="Franchise"
        value={draft.franchise}
        onChange={(franchise) => set({ franchise })}
        maxLength={60}
        placeholder="Defaults to the name"
        hint="The group the picker files it under. One pack per era: 'Final Fantasy' with an edition of 'VII'."
      />
      <TextField
        label="Edition"
        value={draft.edition}
        onChange={(edition) => set({ edition })}
        maxLength={60}
        placeholder="Empty for a single-era world"
      />
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">Edition order</span>
        <input
          type="number"
          min={0}
          max={999}
          value={draft.editionOrder}
          onChange={(event) => set({ editionOrder: Math.max(0, Math.min(999, Number(event.target.value) || 0)) })}
          className={ui.input}
        />
        <span className="mt-1 block text-[11px] text-stone-500">Sorts editions inside the franchise, release order first.</span>
      </label>
    </div>
  );
}

export function WorldFields({ draft, onDraft }: SectionProps) {
  const set = (patch: Partial<WorldPackDraft>) => onDraft({ ...draft, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">
          Base genre <span className="text-amber-400/80">*</span>
        </span>
        <select
          value={draft.baseGenre}
          onChange={(event) => set({ baseGenre: event.target.value as WorldPackDraft["baseGenre"] })}
          className={ui.input}
        >
          {GENRE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-stone-500">
          Every campaign that picks this world also takes this genre, so everything that knows about genres keeps working.
        </span>
      </label>
      <TextField
        label="Theme"
        value={draft.theme}
        onChange={(theme) => set({ theme })}
        maxLength={120}
        placeholder="Salvage, faith and the things under the water"
        hint="Seeds the campaign's theme line."
        required
      />
      <TextField
        label="Premise"
        value={draft.premise}
        onChange={(premise) => set({ premise })}
        maxLength={500}
        rows={3}
        placeholder="Where a new campaign in this world starts, in a paragraph."
        hint="Seeds the campaign description."
        className="sm:col-span-2"
      />
      <div className="sm:col-span-2">
        <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">Alignments this world leans on</span>
        <ChipList
          items={draft.alignments}
          onChange={(alignments) => set({ alignments })}
          options={ALIGNMENT_OPTIONS}
          prompt="Add an alignment"
          labelFor={(code) => catalogLabel(ALIGNMENT_OPTIONS, code)}
          max={9}
        />
      </div>
    </div>
  );
}

export function VoiceFields({ draft, onDraft }: SectionProps) {
  const set = (patch: Partial<WorldPackDraft>) => onDraft({ ...draft, ...patch });
  const thin = draft.dmFlavor.trim().length < DM_FLAVOR_FLOOR;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        label="The narrator's brief"
        value={draft.dmFlavor}
        onChange={(dmFlavor) => set({ dmFlavor })}
        maxLength={1400}
        rows={6}
        placeholder="Tone, what magic feels like, what the stakes are, what the narrator must never do."
        hint={
          thin
            ? `The highest-leverage field in the pack. ${DM_FLAVOR_FLOOR} characters or more is what steers the narrator; this is ${draft.dmFlavor.trim().length}.`
            : "Appended to the genre's own brief in the narrator's system prompt."
        }
        className="sm:col-span-2"
      />
      <TextField
        label="Portrait style"
        value={draft.portraitStyle}
        onChange={(portraitStyle) => set({ portraitStyle })}
        maxLength={300}
        placeholder="Painted, weathered, brine-stained leathers"
        hint="Art-style words for portraits."
      />
      <TextField
        label="Map style"
        value={draft.mapStyle}
        onChange={(mapStyle) => set({ mapStyle })}
        maxLength={300}
        placeholder="Inked nautical charts, kelp-green wash"
        hint="Art-style words for maps."
      />
      <TextField
        label="Name hints"
        value={draft.nameHints}
        onChange={(nameHints) => set({ nameHints })}
        maxLength={300}
        placeholder="Dwarven names with tide-words; surnames are the ship they were born on"
        hint="One line for the story-setup pass."
      />
      <TextField
        label="Race hint"
        value={draft.raceHint}
        onChange={(raceHint) => set({ raceHint })}
        maxLength={300}
        placeholder="Most people are dwarves or sea-elves; humans are traders from upriver"
        hint="One line for the companion tools."
      />
      <div className="sm:col-span-2">
        <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">Companion races</span>
        <ChipList
          items={draft.companionRaces}
          onChange={(companionRaces) => set({ companionRaces })}
          options={RACE_OPTIONS}
          prompt="Allow a race for AI companions"
          labelFor={(id) => catalogLabel(RACE_OPTIONS, id)}
        />
        <p className="mt-1 text-[11px] text-stone-500">Empty means no restriction.</p>
      </div>
    </div>
  );
}

export function IdentitySection(props: SectionProps) {
  return (
    <div className="space-y-6">
      <section className={ui.card + " p-4"}>
        <h3 className="mb-3 font-display text-base tracking-wide text-amber-200">What it is called</h3>
        <NameFields {...props} />
      </section>
      <section className={ui.card + " p-4"}>
        <h3 className="mb-3 font-display text-base tracking-wide text-amber-200">Whose world it is</h3>
        <OriginFields {...props} />
      </section>
      <section className={ui.card + " p-4"}>
        <h3 className="mb-3 font-display text-base tracking-wide text-amber-200">What kind of world</h3>
        <WorldFields {...props} />
      </section>
      <section className={ui.card + " p-4"}>
        <h3 className="mb-3 font-display text-base tracking-wide text-amber-200">How the narrator sounds</h3>
        <VoiceFields {...props} />
      </section>
    </div>
  );
}
