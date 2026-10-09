"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ContentPick } from "@/components/ui/ContentPick";
import { CREATURE_TYPES } from "@/lib/bestiary/statblock";
import { CLASS_WORDS, SKILL_IDS } from "@/lib/homebrew/item-magic-schema";
import { CheckField, NumberField, SelectField, TextField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { DAMAGE_TYPES } from "@/app/workshop/homebrew/types";
import { MechGroup, list, num, sub, type Mech } from "@/app/workshop/homebrew/MechGroup";
import { addChip, rowIcon } from "@/app/workshop/kit";

// The rest of a magic item's magic, in the words the engines read the SRD's
// by (src/lib/homebrew/item-magic-schema.ts): what a magic weapon adds to a
// hit, what magic armour forgives, charges and how they come back, the
// spells charges cast, what it adds to checks, who may attune, a curse. A
// copy of a published item arrives with these filled from the book.

type Props = { data: Mech; set: (patch: Mech) => void };

const CREATURE_WORDS = CREATURE_TYPES.map((type) => type as string);
const SKILL_LABELS = Object.fromEntries(SKILL_IDS.map((id) => [id, id.replace(/_/g, " ")])) as Record<(typeof SKILL_IDS)[number], string>;
const RIDER_TYPES = [{ value: "weapon", label: "the weapon's own" }, ...DAMAGE_TYPES.map((value) => ({ value, label: value }))];
const optional = (value: number | ""): number | undefined => (value === "" || value === 0 ? undefined : value);
const clean = (value: Mech): Mech | undefined => {
  const out = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "" && !(Array.isArray(entry) && !entry.length)));
  return Object.keys(out).length ? out : undefined;
};

function DiceRows({ title, rows, onChange }: { title: string; rows: Mech[]; onChange: (next: Mech[]) => void }) {
  return (
    <div className="col-span-2 space-y-1.5 sm:col-span-4">
      <span className="text-[11px] text-stone-400">{title}</span>
      {rows.map((row, index) => (
        <div key={index} className="live-in flex flex-wrap items-end gap-2">
          <TextField label="Dice" value={String(row.dice ?? "")} onChange={(dice) => onChange(rows.map((entry, at) => (at === index ? { ...entry, dice } : entry)))} maxLength={40} className="w-24" />
          <SelectField label="Type" value={String(row.type ?? "weapon")} options={RIDER_TYPES} onChange={(type) => onChange(rows.map((entry, at) => (at === index ? { ...entry, type } : entry)))} className="w-40" />
          <CheckField label="Ranged only" checked={row.ranged === true} onChange={(ranged) => onChange(rows.map((entry, at) => (at === index ? { ...entry, ranged: ranged || undefined } : entry)))} />
          <button type="button" aria-label="Remove these dice" onClick={() => onChange(rows.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
            <Trash2 className="size-3.5" />
          </button>
          <div className="basis-full">
            <span className="text-[11px] text-stone-500">Only against</span>
            <ToggleChips options={CREATURE_WORDS} selected={list(row.vs)} onChange={(vs) => onChange(rows.map((entry, at) => (at === index ? { ...entry, vs: vs.length ? vs : undefined } : entry)))} />
          </div>
        </div>
      ))}
      {rows.length < 4 ? (
        <button type="button" onClick={() => onChange([...rows, { dice: "1d6", type: "fire" }])} className={cn(ui.btnSmall, addChip, "w-fit")}>
          <Plus className="size-3" /> Dice
        </button>
      ) : null}
    </div>
  );
}

export function WeaponRidersBlock({ data, set }: Props) {
  const riders = sub(data.weaponRiders);
  const put = (patch: Mech) => set({ weaponRiders: clean({ ...riders, ...patch }) });
  const extra = Array.isArray(riders.extra) ? (riders.extra as Mech[]) : [];
  const crit = Array.isArray(riders.critExtra) ? (riders.critExtra as Mech[]) : [];
  const bonusVs = sub(riders.bonusVs);
  const summary = [num(riders.bonus) ? `+${num(riders.bonus)}` : "", ...extra.map((row) => `+${String(row.dice)} ${String(row.type)}`)].filter(Boolean).join(", ");
  return (
    <MechGroup title="What the weapon's magic adds" summary={summary || "nothing yet"} open={Object.keys(riders).length > 0}>
      <NumberField label="Bonus to hit and damage" value={num(riders.bonus)} min={0} max={3} onChange={(bonus) => put({ bonus: optional(bonus) })} />
      <SelectField label="Damage type becomes" value={String(riders.damageType ?? "")} options={[{ value: "", label: "unchanged" }, ...DAMAGE_TYPES.map((value) => ({ value, label: value }))]} onChange={(damageType) => put({ damageType: damageType || undefined })} />
      <NumberField label="Thrown range (ft)" value={num(riders.rangeFt)} min={0} max={600} step={5} onChange={(rangeFt) => put({ rangeFt: optional(rangeFt) })} />
      <NumberField label="Long range (ft)" value={num(riders.longRangeFt)} min={0} max={1200} step={5} onChange={(longRangeFt) => put({ longRangeFt: optional(longRangeFt) })} />
      <DiceRows title="Extra dice on every hit" rows={extra} onChange={(next) => put({ extra: next.length ? next : undefined })} />
      <DiceRows title="Extra dice on a critical hit" rows={crit} onChange={(next) => put({ critExtra: next.length ? next : undefined })} />
      <NumberField label="More to hit and damage against" value={num(bonusVs.bonus)} min={0} max={3} onChange={(bonus) => put({ bonusVs: bonus ? { types: list(bonusVs.types), bonus } : undefined })} />
      {riders.bonusVs ? (
        <div className="col-span-2 sm:col-span-3">
          <ToggleChips options={CREATURE_WORDS} selected={list(bonusVs.types)} onChange={(types) => put({ bonusVs: { ...bonusVs, types } })} />
        </div>
      ) : null}
    </MechGroup>
  );
}

export function ArmorRidersBlock({ data, set }: Props) {
  const riders = sub(data.armorRiders);
  const put = (patch: Mech) => set({ armorRiders: clean({ ...riders, ...patch }) });
  return (
    <MechGroup title="What the armour's magic adds" summary={num(riders.bonus) ? `+${num(riders.bonus)} AC` : "nothing yet"} open={Object.keys(riders).length > 0}>
      <NumberField label="Bonus to AC" value={num(riders.bonus)} min={0} max={3} onChange={(bonus) => put({ bonus: optional(bonus) })} />
      <div className="col-span-2 flex flex-wrap items-end gap-3 pb-1 sm:col-span-3">
        <CheckField label="No Strength requirement" checked={riders.noStrength === true} onChange={(on) => put({ noStrength: on || undefined })} />
        <CheckField label="No Stealth disadvantage" checked={riders.noStealthPenalty === true} onChange={(on) => put({ noStealthPenalty: on || undefined })} />
        <CheckField label="Worn as if trained" checked={riders.proficientAnyway === true} onChange={(on) => put({ proficientAnyway: on || undefined })} />
        <CheckField label="Critical hits become normal hits" checked={riders.critProof === true} onChange={(on) => put({ critProof: on || undefined })} />
      </div>
    </MechGroup>
  );
}

export function ChargesBlock({ data, set }: Props) {
  const charges = sub(data.charges);
  const put = (patch: Mech) => set({ charges: clean({ ...charges, ...patch }) });
  const regain = String(charges.regain ?? "");
  return (
    <MechGroup title="Charges" summary={charges.max ? `${String(charges.max)}${regain ? `, ${regain === "all" ? "all" : regain} back at dawn` : ", never refill"}` : "none"} open={Boolean(charges.max)}>
      <TextField label="Most it holds" value={String(charges.max ?? "")} onChange={(max) => (max ? put({ max: /^\d+$/.test(max) ? Number(max) : max }) : set({ charges: undefined }))} placeholder="7 or 1d4-1" maxLength={20} hint="A number, or dice rolled the first time it is used." />
      <SelectField label="At dawn" value={regain === "all" ? "all" : regain ? "dice" : ""} options={[{ value: "", label: "nothing comes back" }, { value: "all", label: "every charge" }, { value: "dice", label: "dice of charges" }]} onChange={(next) => put({ regain: next === "all" ? "all" : next === "dice" ? "1d6+1" : undefined })} />
      {regain && regain !== "all" ? <TextField label="Regains" value={regain} onChange={(dice) => put({ regain: dice || undefined })} maxLength={20} /> : null}
      <div className="col-span-2 flex flex-wrap items-end gap-3 pb-1">
        <CheckField label="Last charge: d20, a 1 destroys it" checked={charges.lastChargeD20 === true} onChange={(on) => put({ lastChargeD20: on || undefined })} />
        <CheckField label="Gone when the last is spent" checked={charges.spentAway === true} onChange={(on) => put({ spentAway: on || undefined })} />
      </div>
      <TextField label="Once a day it can" value={String(charges.daily ?? "")} onChange={(daily) => put({ daily: daily || undefined })} placeholder="turn resistance into immunity for 10 minutes" maxLength={200} className="col-span-2 sm:col-span-4" />
    </MechGroup>
  );
}

export function ItemSpellsBlock({ data, set }: Props) {
  const spells = Array.isArray(data.spells) ? (data.spells as Mech[]) : [];
  const put = (next: Mech[]) => set({ spells: next.length ? next : undefined });
  return (
    <MechGroup title="Spells its charges cast" summary={spells.length ? spells.map((row) => String(row.spell)).join(", ") : "none"} open={spells.length > 0}>
      {spells.map((row, index) => (
        <div key={index} className="live-in col-span-2 flex flex-wrap items-end gap-2 sm:col-span-4">
          <span className="min-w-32 pb-2 text-xs text-stone-200">{String(row.spell)}</span>
          <NumberField label="Charges" value={num(row.charges, 1)} min={0} max={50} onChange={(charges) => put(spells.map((entry, at) => (at === index ? { ...entry, charges: charges === "" ? 1 : charges } : entry)))} className="w-24" />
          <NumberField label="Cast at level" value={num(row.level, 1)} min={0} max={9} onChange={(level) => put(spells.map((entry, at) => (at === index ? { ...entry, level: level === "" ? 1 : level } : entry)))} className="w-24" />
          <CheckField label="Each charge more, a level up" checked={row.perCharge === true} onChange={(perCharge) => put(spells.map((entry, at) => (at === index ? { ...entry, perCharge: perCharge || undefined } : entry)))} />
          <NumberField label="Save DC" value={num(row.dc)} min={0} max={30} onChange={(dc) => put(spells.map((entry, at) => (at === index ? { ...entry, dc: optional(dc) } : entry)))} hint="Empty: the wielder's own." className="w-28" />
          <button type="button" aria-label={`Remove ${String(row.spell)}`} onClick={() => put(spells.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="col-span-2 sm:col-span-4">
        <ContentPick
          kind="spells"
          label="Find a spell the item casts"
          placeholder="Add a spell it casts..."
          onPick={(entry) => {
            if (spells.some((row) => String(row.spell).toLowerCase() === entry.name.toLowerCase())) return;
            put([...spells, { spell: entry.name, charges: 1, level: typeof entry.level === "number" ? entry.level : 1 }]);
          }}
        />
      </div>
    </MechGroup>
  );
}

export function ChecksBlock({ data, set }: Props) {
  const checks = sub(data.checks);
  const skillBonus = sub(checks.skillBonus) as Record<string, number>;
  const put = (patch: Mech) => set({ checks: clean({ ...checks, ...patch }) });
  const bonused = Object.keys(skillBonus);
  return (
    <MechGroup title="What it adds to checks" summary={[num(checks.bonus) ? `+${num(checks.bonus)} to every check` : "", ...bonused.map((skill) => `+${skillBonus[skill]} ${skill.replace(/_/g, " ")}`), list(checks.advantage).length ? `advantage on ${list(checks.advantage).join(", ").replace(/_/g, " ")}` : ""].filter(Boolean).join(", ") || "nothing"} open={Object.keys(checks).length > 0}>
      <NumberField label="Every ability check" value={num(checks.bonus)} min={-5} max={5} onChange={(bonus) => put({ bonus: optional(bonus) })} />
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">A bonus to these skills</span>
        <ToggleChips options={SKILL_IDS} labels={SKILL_LABELS} selected={bonused} onChange={(next) => put({ skillBonus: clean(Object.fromEntries(next.map((skill) => [skill, skillBonus[skill] ?? 2]))) })} />
      </div>
      {bonused.map((skill) => (
        <NumberField key={skill} label={skill.replace(/_/g, " ")} value={skillBonus[skill]} min={-10} max={10} onChange={(value) => put({ skillBonus: clean({ ...skillBonus, [skill]: value === "" ? undefined : value }) })} />
      ))}
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Advantage on</span>
        <ToggleChips options={SKILL_IDS} labels={SKILL_LABELS} selected={list(checks.advantage)} onChange={(next) => put({ advantage: next.length ? next : undefined })} />
      </div>
    </MechGroup>
  );
}

export function AttunementBlock({ data, set }: Props) {
  const rule = sub(data.attunedBy);
  const classes = list(rule.classes);
  const put = (patch: Mech) => {
    const next = { ...rule, ...patch };
    const who = [
      ...list(next.classes).map((name) => `a ${name}`),
      next.spellcaster ? "a spellcaster" : "",
      next.race ? `a ${String(next.race)}` : "",
      next.alignment ? `a creature of ${String(next.alignment)} alignment` : "",
    ].filter(Boolean);
    set({ attunedBy: who.length ? clean({ ...next, text: who.join(" or ") }) : undefined });
  };
  return (
    <MechGroup title="Who may attune, and a curse" summary={[String(rule.text ?? ""), data.cursed ? "cursed" : "", data.carried ? "works from the pack" : ""].filter(Boolean).join(", ") || "anyone"} open={Boolean(data.attunedBy || data.cursed || data.carried)}>
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Only these classes</span>
        <ToggleChips options={CLASS_WORDS} selected={classes} onChange={(next) => put({ classes: next.length ? next : undefined })} />
      </div>
      <div className="flex items-end pb-1">
        <CheckField label="Any spellcaster" checked={rule.spellcaster === true} onChange={(on) => put({ spellcaster: on || undefined })} />
      </div>
      <TextField label="Only a (race)" value={String(rule.race ?? "")} onChange={(race) => put({ race: race || undefined })} placeholder="dwarf" maxLength={40} />
      <TextField label="Only of alignment" value={String(rule.alignment ?? "")} onChange={(alignment) => put({ alignment: alignment || undefined })} placeholder="good" maxLength={40} />
      <div className="col-span-2 flex flex-wrap items-end gap-3 pb-1 sm:col-span-4">
        <CheckField label="Cursed: the attunement holds until remove curse" checked={data.cursed === true} onChange={(on) => set({ cursed: on || undefined })} />
        <CheckField label="Works from the pack, worn or not" checked={data.carried === true} onChange={(on) => set({ carried: on || undefined })} />
      </div>
    </MechGroup>
  );
}
