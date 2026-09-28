"use client";

import { Shield } from "lucide-react";
import { contentSlug } from "@/lib/help";
import {
  kitSlotsByLine,
  optionAllowed,
  slotChoices,
  describeSlot,
  type ClassKit,
  type KitChoices,
  type KitTraining,
} from "@/lib/srd/starting-kit";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import type { DerivedLine } from "./derivedReasons";
import OptionPicker from "./OptionPicker";
import { PickPill, inputClass } from "./steps/shared";

const LETTERS = "abcdef";
const damageOf = new Map(SRD_WEAPONS.map((weapon) => [weapon.name, weapon.damage]));
const capital = (text: string) => text.replace(/^./, (first) => first.toUpperCase());

// The class's starting equipment as the book prints it, one line at a time:
// an either-or line is a row of pills, an "any simple weapon" a picker over
// the weapons that qualify, and a line with no choice is simply read out.
// What the choices come to is on the chips below, and the armor class
// follows from them.
export default function KitChoicesSection({
  kit,
  choices,
  training,
  className,
  armorClass,
  onOption,
  onPick,
}: {
  kit: ClassKit;
  choices: KitChoices;
  training: KitTraining;
  className: string;
  // The armor engine's number for the gear as it stands (derivedReasons.ts).
  armorClass: DerivedLine;
  onOption: (line: number, option: number) => void;
  onPick: (slot: number, name: string) => void;
}) {
  const slotLines = kitSlotsByLine(kit, choices.options);
  return (
    <div className="mb-3 space-y-2.5">
      <p className="text-xs text-stone-500">
        {kit.source === "odm"
          ? `The ${className}'s kit, free. Remove what you will not carry.`
          : `The ${className}'s starting equipment, free. Where the book offers a choice, pick one.`}
      </p>
      {kit.lines.map((line, lineIndex) => {
        const chosen = choices.options[lineIndex] ?? 0;
        const { start, slots } = slotLines[lineIndex];
        return (
          <div key={lineIndex} className="space-y-1.5">
            {line.options.length > 1 ? (
              <div role="group" aria-label={`Equipment choice ${lineIndex + 1}`} className="flex flex-wrap gap-1.5">
                {line.options.map((option, optionIndex) => {
                  const allowed = optionAllowed(option, training);
                  return (
                    <PickPill
                      key={option.label}
                      selected={chosen === optionIndex}
                      disabled={!allowed}
                      onClick={() => onOption(lineIndex, optionIndex)}
                    >
                      <span className="text-stone-500">({LETTERS[optionIndex]})</span> {option.label}
                    </PickPill>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-stone-300">{capital(line.options[0].label)}</p>
            )}
            {slots.length ? (
              <div key={`${lineIndex}-${chosen}`} className="reveal grid gap-1.5 sm:grid-cols-2">
                {slots.map((slot, at) => (
                  <div key={at}>
                    <span className="mb-1 block text-[11px] text-stone-400">{capital(describeSlot(slot))}</span>
                    <OptionPicker
                      value={choices.picks[start + at] ?? slot.default}
                      onChange={(name) => onPick(start + at, name)}
                      className={inputClass}
                      groups={[
                        {
                          label: null,
                          options: slotChoices(slot).map((name) => ({
                            id: name,
                            name,
                            meta: damageOf.get(name) ?? "",
                            reference: { kind: "items" as const, slug: contentSlug(name), name },
                          })),
                        },
                      ]}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-baseline gap-2">
        <Shield className="size-3.5 self-center text-amber-300/80" aria-hidden="true" />
        <span className="text-xs text-stone-400">Armor class with this kit</span>
        <span key={armorClass.value} className="reveal font-mono text-sm text-amber-200">
          {armorClass.value}
        </span>
      </div>
      <p className="text-[11px] text-stone-500">{armorClass.reason}</p>
    </div>
  );
}
