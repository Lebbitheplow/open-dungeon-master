"use client";

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { NumberField, SelectField, TextArea, TextField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { ChipList } from "@/app/workshop/plugin/fields";
import { MechGroup, list, num, sub } from "@/app/workshop/homebrew/MechGroup";
import { LANGUAGES, TOOL_PROFICIENCIES, VISION_SUGGESTIONS } from "@/lib/workshop/pickers";
import { SKILL_IDS } from "@/lib/homebrew/item-magic-schema";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import { addChip, rowIcon } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";

// A species: the numbers the builder reads (scores, speed, size, languages),
// the structured grants the SRD's races carry (skills, tools, weapon and
// armor training, a cantrip, the picks it leaves the player) and its traits.
// Everything here is what the builder offers and the creation check holds a
// character to (src/lib/homebrew/race-data.ts); the size and the dwarf's
// heavy-armor clause are read at the table (src/lib/srd/race-id.ts).

type Props = { data: Data; set: (patch: Data) => void };
type AsiRow = { attributes: string[]; value: number };

const ABILITY_NAMES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;
const ABILITY_IDS = ["str", "dex", "con", "int", "wis", "cha"] as const;
const ABILITY_LABELS = Object.fromEntries(ABILITY_IDS.map((id) => [id, id.toUpperCase()])) as Record<(typeof ABILITY_IDS)[number], string>;
const SKILL_LABELS = Object.fromEntries(SKILL_IDS.map((id) => [id, id.replace(/_/g, " ")])) as Record<(typeof SKILL_IDS)[number], string>;
const ARMOR = ["light", "medium", "heavy", "shields"] as const;
const CANTRIP_LISTS = ["", "bard", "cleric", "druid", "sorcerer", "warlock", "wizard"];
const TOOLS = TOOL_PROFICIENCIES.map((tool) => tool.toLowerCase());
// As the SRD's races write their training: "battleaxes", "martial weapons".
const WEAPONS = ["simple weapons", "martial weapons", ...SRD_WEAPONS.map((weapon) => `${weapon.name.toLowerCase()}s`)];

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// Languages are a list; a species written before they were kept as text.
function languageList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return String(value ?? "")
    .split(/,|\band\b/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function AbilityIncreases({ data, set }: Props) {
  const asi = Array.isArray(data.asi) ? (data.asi as AsiRow[]) : [];
  const put = (next: AsiRow[]) => set({ asi: next });
  const choice = sub(data.asiChoice);
  const putChoice = (patch: Data) => {
    const next = { ...choice, ...patch };
    set({ asiChoice: num(next.count) > 0 ? next : undefined });
  };
  return (
    <div className="space-y-1.5 text-sm">
      <SectionHead title="Ability score increases" glyph="ability-str" className="mb-1" />
      {asi.map((row, index) => (
        <div key={index} className="live-in flex flex-wrap items-center gap-1.5">
          <span className="w-44">
            <Select
              value={row.attributes[0] ?? "Strength"}
              label="Ability"
              options={ABILITY_NAMES.map((name) => ({
                value: name as string,
                label: name,
                icon: { kind: "glyph" as const, key: `ability-${name.slice(0, 3).toLowerCase()}` },
              }))}
              onChange={(name) => put(asi.map((entry, at) => (at === index ? { ...entry, attributes: [name] } : entry)))}
            />
          </span>
          <NumberStepper label="Increase" value={row.value} min={-2} max={3} onChange={(value) => put(asi.map((entry, at) => (at === index ? { ...entry, value } : entry)))} />
          <button type="button" aria-label="Remove increase" onClick={() => put(asi.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {asi.length < 6 ? (
        <button type="button" onClick={() => put([...asi, { attributes: ["Dexterity"], value: 1 }])} className={cn(ui.btnSmall, addChip)}>
          <Plus className="size-3" /> Add an increase
        </button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-stone-400">
        <span>And the player picks</span>
        <NumberStepper size="sm" label="Abilities the player picks" value={num(choice.count)} min={0} max={3} onChange={(count) => putChoice({ count })} />
        <span>abilities to raise by</span>
        <NumberStepper size="sm" label="Raised by" value={num(choice.amount, 1)} min={1} max={2} onChange={(amount) => putChoice({ amount })} />
      </div>
      {num(choice.count) > 0 ? (
        <div className="live-in space-y-1">
          <span className="text-[11px] text-stone-400">From (none ticked: any ability)</span>
          <ToggleChips options={ABILITY_IDS} labels={ABILITY_LABELS} selected={list(choice.from)} onChange={(from) => putChoice({ from: from.length ? from : undefined })} />
        </div>
      ) : null}
    </div>
  );
}

function Languages({ data, set }: Props) {
  const known = languageList(data.languages);
  const choice = sub(data.languageChoice);
  const from = list(choice.from);
  const putChoice = (patch: Data) => {
    const next = { count: num(choice.count, 1), from, ...patch };
    set({ languageChoice: list(next.from).length ? next : undefined });
  };
  return (
    <div className="space-y-1.5 text-sm">
      <SectionHead title="Languages" glyph="system-lore" className="mb-1" />
      <ChipList items={known} onChange={(languages) => set({ languages })} options={LANGUAGES} prompt="Add a language" max={12} />
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
        <span>Plus</span>
        <NumberStepper size="sm" label="Languages of the player's choice" value={num(data.bonusLanguages)} min={0} max={4} onChange={(bonusLanguages) => set({ bonusLanguages: bonusLanguages || undefined })} />
        <span>of the player&apos;s choice</span>
      </div>
      <div className="space-y-1">
        <span className="text-[11px] text-stone-400">Or a pick from a short list (&quot;Common or Undercommon&quot;)</span>
        <ChipList items={from} onChange={(next) => putChoice({ from: next })} options={LANGUAGES} prompt="Offer a language" max={12} />
        {from.length ? (
          <span className="live-in flex items-center gap-2 text-[11px] text-stone-400">
            The player picks
            <NumberStepper size="sm" label="Languages picked from the list" value={num(choice.count, 1)} min={1} max={3} onChange={(count) => putChoice({ count })} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Training({ data, set }: Props) {
  const skills = list(data.skills);
  const tools = list(data.tools);
  const toolChoice = sub(data.toolChoice);
  const toolFrom = list(toolChoice.from);
  const armor = list(data.armor);
  const weapons = list(data.weapons);
  const cantrip = sub(data.cantripChoice);
  const summary = [
    skills.length ? skills.join(", ").replace(/_/g, " ") : "",
    num(sub(data.skillChoice).count) ? `${num(sub(data.skillChoice).count)} skills of choice` : "",
    tools.length ? tools.join(", ") : "",
    armor.length ? `${armor.join(", ")} armor` : "",
    weapons.length ? `${weapons.length} weapons` : "",
    cantrip.list ? `a ${String(cantrip.list)} cantrip` : "",
  ].filter(Boolean).join("; ");
  const open = summary.length > 0;
  const putToolChoice = (patch: Data) => {
    const next = { count: num(toolChoice.count, 1), from: toolFrom, ...patch };
    set({ toolChoice: list(next.from).length ? next : undefined });
  };
  return (
    <MechGroup title="What it trains" summary={summary || "nothing"} open={open}>
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Skills it is proficient in</span>
        <ToggleChips options={SKILL_IDS} labels={SKILL_LABELS} selected={skills} onChange={(next) => set({ skills: next.length ? next : undefined })} />
      </div>
      <NumberField
        label="Skills of the player's choice"
        value={num(sub(data.skillChoice).count)}
        min={0}
        max={4}
        onChange={(count) => set({ skillChoice: count ? { count } : undefined })}
      />
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Tools it is proficient with</span>
        <ChipList items={tools} onChange={(next) => set({ tools: next.length ? next : undefined })} options={TOOLS} prompt="Add a tool" max={6} />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Or one tool of the player&apos;s choice from</span>
        <ChipList items={toolFrom} onChange={(from) => putToolChoice({ from })} options={TOOLS} prompt="Offer a tool" max={12} />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Armor training</span>
        <ToggleChips options={ARMOR} selected={armor} onChange={(next) => set({ armor: next.length ? next : undefined })} />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Weapon training</span>
        <ChipList items={weapons} onChange={(next) => set({ weapons: next.length ? next : undefined })} options={WEAPONS} prompt="Add a weapon" max={12} />
      </div>
      <SelectField
        label="A cantrip from"
        value={String(cantrip.list ?? "")}
        options={CANTRIP_LISTS.map((value) => ({ value, label: value ? `the ${value} list` : "no list" }))}
        onChange={(value) => set({ cantripChoice: value ? { list: value, count: num(cantrip.count, 1) } : undefined })}
      />
      {cantrip.list ? (
        <NumberField label="Cantrips" value={num(cantrip.count, 1)} min={1} max={3} onChange={(count) => set({ cantripChoice: { list: cantrip.list, count: count || 1 } })} />
      ) : null}
    </MechGroup>
  );
}

export function SpeciesFields({ data, set }: Props) {
  const speed = (data.speed as { walk?: number } | undefined)?.walk ?? 30;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField
          label="Size"
          value={capital(String(data.size ?? "Medium").toLowerCase())}
          options={["Tiny", "Small", "Medium", "Large"].map((value) => ({ value, label: value }))}
          onChange={(size) => set({ size })}
          hint="A Small creature swings a heavy weapon at disadvantage."
        />
        <NumberField label="Speed (ft)" value={speed} min={5} max={120} step={5} onChange={(walk) => set({ speed: { walk: walk === "" ? 30 : walk } })} />
        <TextField
          label="Vision"
          value={String(data.vision ?? "")}
          onChange={(vision) => set({ vision })}
          placeholder="Darkvision 60 ft"
          maxLength={120}
          suggestions={VISION_SUGGESTIONS}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-xs text-stone-300">
          <input
            type="checkbox"
            checked={data.heavyArmorSpeed === true}
            onChange={(event) => set({ heavyArmorSpeed: event.target.checked || undefined })}
            className="accent-amber-500"
          />
          Heavy armor never slows it
        </label>
      </div>
      <AbilityIncreases data={data} set={set} />
      <Languages data={data} set={set} />
      <Training data={data} set={set} />
      <TextArea
        label="Traits"
        value={String(data.traits ?? "")}
        onChange={(traits) => set({ traits })}
        placeholder={"**_Marsh Stride._** Difficult terrain in wetlands costs you no extra movement.\n\n**_Reed Sight._** You have advantage on Perception checks in tall grass."}
        rows={6}
        maxLength={6000}
        hint="One trait per paragraph, its name in bold. A trait named like a published one (Dwarven Toughness, Lucky, Infernal Legacy) is run by the engine at the table."
      />
    </div>
  );
}
