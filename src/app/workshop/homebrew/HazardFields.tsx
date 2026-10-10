"use client";

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { NumberField, SelectField, TextArea, TextField } from "@/app/workshop/homebrew/fields";
import { ChipList } from "@/app/workshop/plugin/fields";
import { MechGroup, list, num, sub, type Mech } from "@/app/workshop/homebrew/MechGroup";
import { addChip, rowIcon } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";

// A hazard: a trap apply_hazard springs by name, a poison or a disease the
// afflict tool lays on by name (src/lib/homebrew/hazard-data.ts). The blocks
// are the SRD's own shapes, so a copy of the Poison Needle or Wyvern Poison
// starts exact and stays editable.

type Props = { data: Data; onChange: (next: Data) => void };

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"].map((value) => ({ value, label: value.toUpperCase() }));
const DAMAGE = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const DAMAGE_OPTIONS = DAMAGE.map((value) => ({ value, label: value }));
const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];
const KINDS = [
  { value: "trap", label: "Trap" },
  { value: "poison", label: "Poison" },
  { value: "disease", label: "Disease" },
];
const optional = (value: number | "") => (value === "" ? undefined : value);
// A block with its emptied fields dropped, so the stored row stays clean.
const tidy = (block: Mech): Mech => Object.fromEntries(Object.entries(block).filter(([, value]) => value !== undefined && !(Array.isArray(value) && !value.length)));

function DamageParts({ title, parts, onChange }: { title: string; parts: Mech[]; onChange: (next: Mech[]) => void }) {
  return (
    <div className="col-span-2 space-y-1 sm:col-span-4">
      <span className="text-[11px] text-stone-400">{title}</span>
      {parts.map((part, index) => (
        <div key={index} className="live-in flex flex-wrap items-center gap-1.5">
          <input
            value={String(part.dice ?? "")}
            aria-label="Damage dice"
            placeholder="2d10"
            maxLength={40}
            onChange={(event) => onChange(parts.map((entry, at) => (at === index ? { ...entry, dice: event.target.value } : entry)))}
            className={cn(ui.input, "w-24 text-sm")}
          />
          <SelectField label="" value={String(part.type ?? "piercing")} options={DAMAGE_OPTIONS} onChange={(type) => onChange(parts.map((entry, at) => (at === index ? { ...entry, type } : entry)))} className="w-36" />
          <button type="button" aria-label="Remove damage" onClick={() => onChange(parts.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {parts.length < 4 ? (
        <button type="button" onClick={() => onChange([...parts, { dice: "1d4", type: "piercing" }])} className={cn(ui.btnSmall, addChip)}>
          <Plus className="size-3" /> Add damage
        </button>
      ) : null}
    </div>
  );
}

function TrapBlock({ block, put }: { block: Mech; put: (patch: Mech) => void }) {
  const spot = sub(block.spot);
  const disarm = sub(block.disarm);
  const save = sub(block.save);
  const damage = sub(block.damage);
  return (
    <>
      <MechGroup title="How it works" summary={String(block.trigger ?? "") || "its trigger"} open>
        <SelectField label="Kind" value={String(block.kind ?? "mechanical")} options={[{ value: "mechanical", label: "mechanical" }, { value: "magic", label: "magic" }]} onChange={(kind) => put({ kind })} />
        <div className="col-span-2 sm:col-span-3">
          <TextField label="Trigger" value={String(block.trigger ?? "")} onChange={(trigger) => put({ trigger })} placeholder="a pressure plate under the third flagstone" maxLength={200} />
        </div>
        <NumberField label="Spot DC" value={num(spot.dc, 0) || ""} min={1} max={30} onChange={(dc) => put({ spot: dc === "" ? undefined : { dc, skill: String(spot.skill ?? "perception") } })} />
        <SelectField label="Spotted with" value={String(spot.skill ?? "perception")} options={["perception", "investigation", "arcana"].map((value) => ({ value, label: value }))} onChange={(skill) => put({ spot: { dc: num(spot.dc, 10), skill } })} />
        <NumberField label="Disarm DC" value={num(disarm.dc, 0) || ""} min={1} max={30} onChange={(dc) => put({ disarm: dc === "" ? undefined : { dc, how: String(disarm.how ?? "thieves' tools") } })} />
        <TextField label="Disarmed by" value={String(disarm.how ?? "")} onChange={(how) => put({ disarm: { dc: num(disarm.dc, 15), how } })} placeholder="thieves' tools" maxLength={200} />
      </MechGroup>
      <MechGroup title="What it does" summary={[save.dc ? `DC ${num(save.dc)} ${String(save.ability ?? "").toUpperCase()}` : "", damage.dice ? `${String(damage.dice)} ${String(damage.type ?? "")}` : "", block.condition ? String(block.condition) : ""].filter(Boolean).join(", ") || "nothing yet"} open>
        <NumberField label="Attack bonus" value={block.attackBonus === undefined ? "" : num(block.attackBonus)} min={-5} max={20} onChange={(value) => put({ attackBonus: optional(value) })} hint="Empty: no attack roll." />
        <NumberField label="Fall (ft)" value={num(block.fallFeet, 0) || ""} min={0} max={500} step={5} onChange={(value) => put({ fallFeet: optional(value) || undefined })} />
        <DamageParts title="Damage nobody saves against" parts={Array.isArray(block.hit) ? (block.hit as Mech[]) : []} onChange={(hit) => put({ hit: hit.length ? hit : undefined })} />
        <SelectField label="Save" value={String(save.ability ?? "")} options={[{ value: "", label: "none" }, ...ABILITIES]} onChange={(ability) => put({ save: ability ? { ability, dc: num(save.dc, 13), halfOnSave: save.halfOnSave !== false } : undefined })} />
        {save.ability ? (
          <>
            <NumberField label="Save DC" value={num(save.dc, 13)} min={1} max={30} onChange={(dc) => put({ save: { ...save, dc: dc === "" ? 13 : dc } })} />
            <SelectField label="On a success" value={save.halfOnSave === false ? "none" : "half"} options={[{ value: "half", label: "half damage" }, { value: "none", label: "no damage" }]} onChange={(value) => put({ save: { ...save, halfOnSave: value === "half" } })} />
            <TextField label="Damage dice" value={String(damage.dice ?? "")} onChange={(dice) => put({ damage: dice ? { dice, type: String(damage.type ?? "piercing") } : undefined })} placeholder="4d10" maxLength={40} />
            <SelectField label="Damage type" value={String(damage.type ?? "piercing")} options={DAMAGE_OPTIONS} onChange={(type) => put({ damage: { dice: String(damage.dice ?? "1d6"), type } })} />
            <SelectField label="On a failure, also" value={String(block.condition ?? "")} options={[{ value: "", label: "nothing" }, ...CONDITIONS.map((value) => ({ value, label: value }))]} onChange={(condition) => put({ condition: condition || undefined })} />
          </>
        ) : null}
        <div className="col-span-2 space-y-1 sm:col-span-4">
          <span className="text-[11px] text-stone-400">On everyone it catches, save or not</span>
          <ChipList items={list(block.conditionsAlways)} onChange={(next) => put({ conditionsAlways: next.length ? next : undefined })} options={CONDITIONS} prompt="Add a condition" max={4} />
        </div>
        <NumberField label="For (rounds)" value={num(block.rounds, 0) || ""} min={1} max={14400} onChange={(value) => put({ rounds: optional(value) })} hint="10 rounds a minute; empty until removed." />
      </MechGroup>
    </>
  );
}

function PoisonBlock({ block, put }: { block: Mech; put: (patch: Mech) => void }) {
  const repeat = sub(block.repeat);
  return (
    <MechGroup title="The poison" summary={[`DC ${num(block.dc, 10)} CON`, block.damage ? String(block.damage) : "", list(block.conditions).join(", ")].filter(Boolean).join(", ")} open>
      <SelectField label="Delivered" value={String(block.type ?? "injury")} options={["contact", "ingested", "inhaled", "injury"].map((value) => ({ value, label: value }))} onChange={(type) => put({ type })} hint="An injury poison coats a blade." />
      <NumberField label="CON save DC" value={num(block.dc, 10)} min={1} max={30} onChange={(dc) => put({ dc: dc === "" ? 10 : dc })} />
      <TextField label="Poison damage" value={String(block.damage ?? "")} onChange={(damage) => put({ damage: damage || undefined })} placeholder="3d6" maxLength={40} />
      <SelectField label="On a success" value={block.halfOnSave ? "half" : "none"} options={[{ value: "half", label: "half damage" }, { value: "none", label: "no damage" }]} onChange={(value) => put({ halfOnSave: value === "half" || undefined })} />
      <div className="col-span-2 space-y-1 sm:col-span-4">
        <span className="text-[11px] text-stone-400">On a failure</span>
        <ChipList items={list(block.conditions)} onChange={(next) => put({ conditions: next.length ? next : undefined })} options={CONDITIONS} prompt="Add a condition" max={4} />
      </div>
      <NumberField label="For (minutes)" value={num(block.minutes, 0) || ""} min={1} max={525600} onChange={(value) => put({ minutes: optional(value) })} />
      <TextField label="Or hours of" value={String(block.hoursDice ?? "")} onChange={(hoursDice) => put({ hoursDice: hoursDice || undefined })} placeholder="4d6" maxLength={40} />
      <NumberField label="Out cold if failed by" value={num(block.unconsciousIfFailBy, 0) || ""} min={1} max={20} onChange={(value) => put({ unconsciousIfFailBy: optional(value) })} />
      <SelectField label="Damage wakes them" value={block.wakesOnDamage ? "yes" : "no"} options={[{ value: "no", label: "no" }, { value: "yes", label: "yes" }]} onChange={(value) => put({ wakesOnDamage: value === "yes" || undefined })} />
      <SelectField
        label="Saves again"
        value={String(repeat.every ?? "")}
        options={[{ value: "", label: "never" }, { value: "turn_start", label: "each turn's start" }, { value: "turn_end", label: "each turn's end" }, { value: "day", label: "every 24 hours" }]}
        onChange={(every) => put({ repeat: every ? { every, successes: num(repeat.successes, 1), ...(repeat.damage ? { damage: repeat.damage } : {}) } : undefined })}
      />
      {repeat.every ? (
        <>
          <NumberField label="Successes to end" value={num(repeat.successes, 1)} min={1} max={20} onChange={(successes) => put({ repeat: { ...repeat, successes: successes === "" ? 1 : successes } })} />
          <TextField label="Damage each failure" value={String(repeat.damage ?? "")} onChange={(damage) => put({ repeat: { ...repeat, damage: damage || undefined } })} placeholder="1d6" maxLength={40} />
        </>
      ) : null}
      <SelectField label="Waits for midnight" value={block.atMidnight ? "yes" : "no"} options={[{ value: "no", label: "no" }, { value: "yes", label: "yes" }]} onChange={(value) => put({ atMidnight: value === "yes" || undefined })} />
      <NumberField label="Price (gp)" value={num(block.priceGp, 0)} min={0} max={100000} onChange={(priceGp) => put({ priceGp: priceGp === "" ? 0 : priceGp })} />
    </MechGroup>
  );
}

function DiseaseBlock({ block, put }: { block: Mech; put: (patch: Mech) => void }) {
  const infect = sub(block.infect);
  const onset = sub(block.onset);
  const rest = sub(block.rest);
  return (
    <>
      <MechGroup title="Catching it" summary={`DC ${num(infect.dc, 11)} ${String(infect.ability ?? "con").toUpperCase()}, symptoms in ${String(onset.dice ?? "1d4")} ${String(onset.unit ?? "days")}`} open>
        <SelectField label="Save" value={String(infect.ability ?? "con")} options={ABILITIES} onChange={(ability) => put({ infect: { ...infect, ability } })} />
        <NumberField label="DC" value={num(infect.dc, 11)} min={1} max={30} onChange={(dc) => put({ infect: { ability: infect.ability ?? "con", dc: dc === "" ? 11 : dc } })} />
        <TextField label="Symptoms after" value={String(onset.dice ?? "1d4")} onChange={(dice) => put({ onset: { unit: onset.unit ?? "days", dice } })} placeholder="1d4" maxLength={40} />
        <SelectField label="Of" value={String(onset.unit ?? "days")} options={[{ value: "hours", label: "hours" }, { value: "days", label: "days" }]} onChange={(unit) => put({ onset: { dice: onset.dice ?? "1d4", unit } })} />
      </MechGroup>
      <MechGroup title="The symptoms" summary={[String(block.condition ?? ""), num(block.exhaustion) ? `${num(block.exhaustion)} exhaustion` : ""].filter(Boolean).join(", ") || "none yet"} open>
        <TextField label="Condition it shows as" value={String(block.condition ?? "")} onChange={(condition) => put({ condition })} placeholder="marsh fever" maxLength={40} />
        <NumberField label="Levels of exhaustion" value={num(block.exhaustion)} min={0} max={5} onChange={(exhaustion) => put({ exhaustion: exhaustion === "" ? 0 : exhaustion })} />
        <div className="col-span-2 space-y-1">
          <span className="text-[11px] text-stone-400">And while sick</span>
          <ChipList items={list(block.conditions)} onChange={(next) => put({ conditions: next.length ? next : undefined })} options={CONDITIONS} prompt="Add a condition" max={4} />
        </div>
      </MechGroup>
      <MechGroup title="After each long rest" summary={rest.ability ? `DC ${num(rest.dc, 11)} ${String(rest.ability).toUpperCase()}` : "no save"} open={Boolean(rest.ability)}>
        <SelectField label="Save" value={String(rest.ability ?? "")} options={[{ value: "", label: "none" }, ...ABILITIES]} onChange={(ability) => put({ rest: ability ? { ability, dc: num(rest.dc, 11), onSuccess: rest.onSuccess ?? "improve", onFail: rest.onFail ?? "worsen", successes: num(rest.successes, 1) } : undefined })} />
        {rest.ability ? (
          <>
            <NumberField label="DC" value={num(rest.dc, 11)} min={1} max={30} onChange={(dc) => put({ rest: { ...rest, dc: dc === "" ? 11 : dc } })} />
            <SelectField label="A success" value={String(rest.onSuccess ?? "improve")} options={[{ value: "improve", label: "sheds a level of exhaustion" }, { value: "recover", label: "counts toward a cure" }]} onChange={(onSuccess) => put({ rest: { ...rest, onSuccess } })} />
            <SelectField label="A failure" value={String(rest.onFail ?? "worsen")} options={[{ value: "worsen", label: "adds a level of exhaustion" }, { value: "nothing", label: "changes nothing" }]} onChange={(onFail) => put({ rest: { ...rest, onFail } })} />
            {rest.onSuccess === "recover" ? (
              <NumberField label="Successes to cure" value={num(rest.successes, 1)} min={1} max={10} onChange={(successes) => put({ rest: { ...rest, successes: successes === "" ? 1 : successes } })} />
            ) : null}
          </>
        ) : null}
      </MechGroup>
      <SelectField
        label="Runs at the table as"
        value={String(block.runsAs ?? "")}
        options={[{ value: "", label: "its own block" }, { value: "cackle_fever", label: "Cackle Fever" }, { value: "sewer_plague", label: "Sewer Plague" }, { value: "sight_rot", label: "Sight Rot" }]}
        onChange={(runsAs) => put({ runsAs: runsAs || undefined })}
        hint="An SRD disease whose own rules apply (cackle fever's falling DC, sight rot's penalty)."
        className="w-72"
      />
    </>
  );
}

export function HazardFields({ data, onChange }: Props) {
  const kind = String(data.hazardKind ?? "trap");
  const block = sub(data[kind]);
  const put = (patch: Mech) => onChange({ ...data, [kind]: tidy({ ...block, ...patch }) });
  return (
    <div className="space-y-3">
      <SelectField label="What it is" value={kind} options={KINDS} onChange={(hazardKind) => onChange({ ...data, hazardKind })} className="w-48" />
      <div key={kind} className="reveal space-y-3">
        {kind === "trap" ? <TrapBlock block={block} put={put} /> : null}
        {kind === "poison" ? <PoisonBlock block={block} put={put} /> : null}
        {kind === "disease" ? <DiseaseBlock block={block} put={put} /> : null}
      </div>
      <TextArea label="What the table is told" value={String(block.summary ?? "")} onChange={(summary) => put({ summary })} rows={2} maxLength={600} hint="One sentence of the rules, given to the DM with the hazard's name." />
    </div>
  );
}
