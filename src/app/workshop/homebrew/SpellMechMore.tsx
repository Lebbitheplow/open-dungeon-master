"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { CONDITIONS } from "@/lib/bestiary/kit";
import { CREATURE_TYPES } from "@/lib/bestiary/statblock";
import { checkSpellMech } from "@/lib/homebrew/spell-mech-schema";
import { CheckField, NumberField, SelectField, TextField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { DAMAGE_TYPES } from "@/app/workshop/homebrew/types";
import { ABILITY_OPTIONS, MechGroup, clean, list, num, sub, type Mech, type MechProps } from "@/app/workshop/homebrew/MechGroup";

// The rarer groups of a spell's block: what a failed save does besides
// damage, a buff's numbers, healing and revival, an aura, a hit point pool,
// and the whole block as text for whatever the form has no field for.

const CREATURE_WORDS = CREATURE_TYPES.map((type) => type as string);
const BUFF_WORDS = ["blessed", "hasted", "shielded", "invisible", "inspired", "aided", "heroic", "warded"];

export function RidersGroup({ mech, setMech }: MechProps) {
  const riders = sub(mech.riders);
  const set = (patch: Mech) => setMech({ riders: clean({ ...riders, ...patch }) });
  const summary = [
    riders.pushFeet ? `pushed ${num(riders.pushFeet)} ft` : "",
    riders.losesAction ? "loses its action" : "",
    riders.disintegrates ? "disintegrates" : "",
    riders.concentrationSave ? "concentration save" : "",
    riders.hpFloor !== undefined ? "cannot kill" : "",
    riders.damageIgnoresSave ? "damage whatever the save" : "",
  ].filter(Boolean).join(", ");
  return (
    <MechGroup title="A failed save also" summary={summary || "nothing more"} open={Object.keys(riders).length > 0}>
      <NumberField label="Pushed (feet)" value={riders.pushFeet === undefined ? "" : num(riders.pushFeet)} min={0} max={120} step={5} onChange={(pushFeet) => set({ pushFeet: pushFeet === "" ? undefined : pushFeet })} />
      <NumberField label="Cannot drop below HP" value={riders.hpFloor === undefined ? "" : num(riders.hpFloor)} min={0} max={1000} onChange={(hpFloor) => set({ hpFloor: hpFloor === "" ? undefined : hpFloor })} hint="Harm: 1." />
      <div className="col-span-2 flex flex-wrap items-end gap-3 pb-1">
        <CheckField label="Loses its next action" checked={riders.losesAction === true} onChange={(on) => set({ losesAction: on || undefined })} />
        <CheckField label="Shrinks max HP by the damage" checked={riders.shrinksMaxHp === true} onChange={(on) => set({ shrinksMaxHp: on || undefined })} />
        <CheckField label="Concentration save" checked={riders.concentrationSave === "con"} onChange={(on) => set({ concentrationSave: on ? "con" : undefined })} />
        <CheckField label="Disintegrates at 0 HP" checked={riders.disintegrates === true} onChange={(on) => set({ disintegrates: on || undefined })} />
        <CheckField label="Advantage on the save in a fight" checked={riders.advantageInFight === true} onChange={(on) => set({ advantageInFight: on || undefined })} />
        <CheckField label="Damage lands whatever the save" checked={riders.damageIgnoresSave === true} onChange={(on) => set({ damageIgnoresSave: on || undefined })} />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Save with disadvantage</span>
        <ToggleChips options={CREATURE_WORDS} selected={list(riders.saveDisadvantageFor)} onChange={(next) => set({ saveDisadvantageFor: next.length ? next : undefined })} />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Take the dice&apos;s maximum</span>
        <ToggleChips options={CREATURE_WORDS} selected={list(riders.maxDamageFor)} onChange={(next) => set({ maxDamageFor: next.length ? next : undefined })} />
      </div>
    </MechGroup>
  );
}

export function BuffGroup({ mech, setMech }: MechProps) {
  const buff = sub(mech.buff);
  const tempHp = sub(buff.tempHp);
  const maxHp = sub(buff.maxHp);
  const set = (patch: Mech) => setMech({ buff: clean({ target: "self", rounds: 10, ...buff, ...patch }) });
  return (
    <MechGroup title="The buff" summary={buff.condition ? `${String(buff.condition)} on ${String(buff.target ?? "self")}, ${num(buff.rounds, 10)} rounds` : "none"} open>
      <TextField label="Condition granted" value={String(buff.condition ?? "")} onChange={(condition) => set({ condition: condition || undefined })} suggestions={[...BUFF_WORDS, ...CONDITIONS]} maxLength={40} />
      <SelectField label="On" value={String(buff.target ?? "self")} options={[{ value: "self", label: "the caster" }, { value: "ally", label: "one ally" }, { value: "allies", label: "several allies" }]} onChange={(target) => set({ target })} />
      <NumberField label="For rounds" value={num(buff.rounds, 10)} min={1} max={144000} onChange={(rounds) => set({ rounds: rounds === "" ? 10 : rounds })} />
      <div className="flex items-end pb-1">
        <CheckField label="Temp HP each turn" checked={buff.tempHpEachTurn === true} onChange={(on) => set({ tempHpEachTurn: on || undefined })} />
      </div>
      <NumberField label="Temp HP" value={tempHp.base === undefined ? "" : num(tempHp.base)} min={0} max={500} onChange={(base) => set({ tempHp: base === "" ? undefined : clean({ ...tempHp, base }) })} />
      <TextField label="Temp HP dice" value={String(tempHp.dice ?? "")} onChange={(dice) => set({ tempHp: clean({ base: num(tempHp.base), ...tempHp, dice: dice || undefined }) })} placeholder="1d4" maxLength={40} />
      <NumberField label="Max HP up" value={maxHp.base === undefined ? "" : num(maxHp.base)} min={0} max={500} onChange={(base) => set({ maxHp: base === "" ? undefined : clean({ ...maxHp, base }) })} hint="Aid: 5." />
      <NumberField label="More per slot level" value={maxHp.perSlotLevel === undefined ? "" : num(maxHp.perSlotLevel)} min={0} max={100} onChange={(perSlotLevel) => set({ maxHp: maxHp.base === undefined ? undefined : clean({ ...maxHp, perSlotLevel: perSlotLevel === "" ? undefined : perSlotLevel }) })} />
    </MechGroup>
  );
}

export function HealGroup({ mech, setMech }: MechProps) {
  const healing = sub(mech.healing);
  const revive = sub(mech.revive);
  const cures = sub(mech.cures);
  const has = Boolean(mech.healing || mech.healPool || mech.revive || mech.cures || mech.dispel || mech.regainEachTurn || mech.maxHpDice);
  const summary = [
    healing.flat ? `heals ${num(healing.flat)}` : "",
    mech.healPool ? `pool of ${num(mech.healPool)}` : "",
    revive.hp ? "revives" : "",
    list(cures.conditions).length ? `ends ${list(cures.conditions).join("/")}` : "",
    mech.dispel ? "dispels" : "",
  ].filter(Boolean).join(", ");
  return (
    <MechGroup title="Healing and restoring" summary={summary || "dice from the prose"} open={has}>
      <NumberField label="Heals a flat" value={healing.flat === undefined ? "" : num(healing.flat)} min={1} max={1000} onChange={(flat) => setMech({ healing: flat === "" ? undefined : clean({ ...healing, flat }) })} hint="Heal: 70." />
      <NumberField label="More per slot level" value={healing.perSlotLevel === undefined ? "" : num(healing.perSlotLevel)} min={0} max={100} onChange={(perSlotLevel) => setMech({ healing: healing.flat === undefined ? undefined : clean({ ...healing, perSlotLevel: perSlotLevel === "" ? undefined : perSlotLevel }) })} />
      <NumberField label="Shared pool" value={mech.healPool === undefined ? "" : num(mech.healPool)} min={1} max={2000} onChange={(healPool) => setMech({ healPool: healPool === "" ? undefined : healPool })} hint="Mass Heal: 700." />
      <NumberField label="Regained each turn" value={mech.regainEachTurn === undefined ? "" : num(mech.regainEachTurn)} min={1} max={100} onChange={(regainEachTurn) => setMech({ regainEachTurn: regainEachTurn === "" ? undefined : regainEachTurn })} />
      <SelectField label="Revives the dead" value={String(revive.hp ?? "")} options={[{ value: "", label: "no" }, { value: "one", label: "with 1 hit point" }, { value: "all", label: "with every hit point" }]} onChange={(hp) => setMech({ revive: hp ? clean({ withinMinutes: 1, ...revive, hp }) : undefined })} />
      {revive.hp ? (
        <NumberField label="Dead no longer than (minutes)" value={num(revive.withinMinutes, 1)} min={1} max={200000000} onChange={(withinMinutes) => setMech({ revive: clean({ ...revive, withinMinutes: withinMinutes === "" ? 1 : withinMinutes }) })} hint="Revivify 1, Raise Dead 14400 (10 days)." />
      ) : null}
      <div className="col-span-2 flex flex-wrap items-end gap-3 pb-1">
        <CheckField label="Ends spells (dispel)" checked={mech.dispel === true} onChange={(on) => setMech({ dispel: on || undefined })} />
        <CheckField label="No modifier on the healing" checked={mech.healNoModifier === true} onChange={(on) => setMech({ healNoModifier: on || undefined })} />
        <CheckField label="Ends every one listed" checked={cures.all === true} onChange={(all) => setMech({ cures: list(cures.conditions).length ? clean({ ...cures, all: all || undefined }) : undefined })} />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <span className="text-[11px] text-stone-400">Ends on the target</span>
        <ToggleChips options={[...CONDITIONS, "cursed", "diseased"]} selected={list(cures.conditions)} onChange={(next) => setMech({ cures: next.length ? clean({ ...cures, conditions: next }) : undefined })} />
      </div>
    </MechGroup>
  );
}

export function AuraGroup({ mech, setMech }: MechProps) {
  const aura = sub(mech.aura);
  const set = (patch: Mech) => setMech({ aura: clean({ radiusFeet: 15, save: "wis", dice: "3d8", baseLevel: num(mech.level, 3), type: "radiant", halfOnSave: true, ...aura, ...patch }) });
  return (
    <MechGroup title="An aura around the caster" summary={aura.dice ? `${num(aura.radiusFeet)} ft, ${String(aura.dice)} ${String(aura.type ?? "")}` : "none"} open={Boolean(mech.aura)}>
      <div className="col-span-2 flex items-end pb-1">
        <CheckField label="Damages enemies who start their turn in it" checked={Boolean(mech.aura)} onChange={(on) => (on ? set({}) : setMech({ aura: undefined }))} />
      </div>
      {mech.aura ? (
        <>
          <NumberField label="Radius (feet)" value={num(aura.radiusFeet, 15)} min={5} max={120} step={5} onChange={(radiusFeet) => set({ radiusFeet: radiusFeet === "" ? 15 : radiusFeet })} />
          <SelectField label="Save" value={String(aura.save ?? "wis")} options={ABILITY_OPTIONS.filter((option) => option.value)} onChange={(save) => set({ save })} />
          <TextField label="Dice" value={String(aura.dice ?? "")} onChange={(dice) => set({ dice })} maxLength={40} />
          <TextField label="Per slot level" value={String(aura.perSlotLevel ?? "")} onChange={(perSlotLevel) => set({ perSlotLevel: perSlotLevel || undefined })} maxLength={40} />
          <SelectField label="Type" value={String(aura.type ?? "radiant")} options={DAMAGE_TYPES.map((value) => ({ value, label: value }))} onChange={(type) => set({ type })} />
          <div className="flex items-end pb-1">
            <CheckField label="Half on a success" checked={aura.halfOnSave === true} onChange={(halfOnSave) => set({ halfOnSave })} />
          </div>
        </>
      ) : null}
    </MechGroup>
  );
}

export function PoolGroup({ mech, setMech }: MechProps) {
  const pool = sub(mech.hitPointPool);
  const set = (patch: Mech) => setMech({ hitPointPool: clean({ dice: "5d8", perSlotLevel: "2d8", condition: "unconscious", rounds: 10, ...pool, ...patch }) });
  return (
    <MechGroup title="A pool of hit points" summary={pool.dice ? `${String(pool.dice)}, ${String(pool.condition ?? "")}` : "none"} open={Boolean(mech.hitPointPool)}>
      <div className="col-span-2 flex items-end pb-1">
        <CheckField label="Sleep-style: no save, weakest first" checked={Boolean(mech.hitPointPool)} onChange={(on) => (on ? set({}) : setMech({ hitPointPool: undefined }))} />
      </div>
      {mech.hitPointPool ? (
        <>
          <TextField label="Pool dice" value={String(pool.dice ?? "")} onChange={(dice) => set({ dice })} maxLength={40} />
          <TextField label="Per slot level" value={String(pool.perSlotLevel ?? "")} onChange={(perSlotLevel) => set({ perSlotLevel })} maxLength={40} />
          <TextField label="Condition" value={String(pool.condition ?? "")} onChange={(condition) => set({ condition })} suggestions={CONDITIONS} maxLength={40} />
          <NumberField label="Rounds" value={num(pool.rounds, 10)} min={1} max={144000} onChange={(rounds) => set({ rounds: rounds === "" ? 10 : rounds })} />
          <div className="col-span-2 sm:col-span-4">
            <span className="text-[11px] text-stone-400">Passes over</span>
            <ToggleChips options={CREATURE_WORDS} selected={list(pool.immuneTypes)} onChange={(next) => set({ immuneTypes: next.length ? next : undefined })} />
          </div>
        </>
      ) : null}
    </MechGroup>
  );
}

// The whole block as text: every field the engine reads, for the ones the
// form has no box for (Divine Word's tiers, Flesh to Stone's tally,
// Command's words). Checked by the same schema the server keeps it by.
export function AdvancedBlock({ mech, onChange }: { mech: Mech; onChange: (next: Mech | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <div className="space-y-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setText(JSON.stringify(mech, null, 2));
          setProblem("");
          setOpen((value) => !value);
        }}
        className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}
      >
        {open ? "Close the block as text" : "Edit the whole block as text"}
      </button>
      {open ? (
        <div className="reveal space-y-1">
          <textarea value={text} rows={10} spellCheck={false} onChange={(event) => setText(event.target.value)} className={cn(ui.input, "w-full font-mono text-[11px]")} aria-label="The spell's block as text" />
          {problem ? <p className="motion-shake text-[11px] text-red-400">{problem}</p> : null}
          <button
            type="button"
            onClick={() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(text);
              } catch {
                setProblem("That is not readable as a block.");
                return;
              }
              const checked = checkSpellMech(parsed);
              if ("error" in checked) {
                setProblem(checked.error);
                return;
              }
              onChange(checked.mech as Mech);
              setOpen(false);
            }}
            className={cn(ui.btnSecondary, "text-xs")}
          >
            Use this block
          </button>
        </div>
      ) : null}
    </div>
  );
}
