"use client";

import { contentSlug } from "@/lib/help";
import type { BackgroundKit } from "@/lib/srd/gear-choices";
import { InfoButton } from "@/components/ui/InfoDialog";
import OptionPicker from "./OptionPicker";
import { PickPill, inputClass } from "./steps/shared";

const LETTERS = "abcdef";

// The background's kit where the book leaves a choice (issue #127): an
// either-or line is a row of pills, the way the class kit's are
// (KitChoicesSection); an alternative that is a kind of tool ("one
// instrument") opens a picker over that kind, the way the class kit's "any
// musical instrument" does; and a "tool of your choice" line says which tool
// it came to from the training picked on the class step, or that the pick
// is still owed there. Lines with no choice are already on the chips below.
export default function BackgroundKitSection({
  kit,
  backgroundName,
  onPick,
}: {
  kit: BackgroundKit;
  backgroundName: string;
  onPick: (index: number, label: string) => void;
}) {
  if (!kit.choices.length && !kit.toolLines.length) {
    return null;
  }
  return (
    <div className="mb-3 space-y-2.5" data-builder-target="backgroundGear">
      <p className="text-xs text-stone-500">
        The {backgroundName}&apos;s kit, free. Where it offers a choice, pick one.
      </p>
      {kit.choices.map((choice, index) => {
        const taken = choice.alternatives[choice.chosen];
        return (
          <div key={choice.line} className="space-y-1.5">
            <div role="group" aria-label={`${backgroundName} kit choice ${index + 1}`} className="flex flex-wrap gap-1.5">
              {choice.alternatives.map((alternative, at) => (
                <PickPill
                  key={alternative.label}
                  selected={choice.chosen === at}
                  onClick={() => onPick(index, alternative.label)}
                  label={alternative.label}
                  info={{
                    reference: {
                      kind: "items",
                      slug: contentSlug(alternative.items[0]?.name ?? alternative.label),
                      name: alternative.items[0]?.name ?? alternative.label,
                    },
                  }}
                >
                  <span className="text-stone-500">({LETTERS[at]})</span> {alternative.label}
                </PickPill>
              ))}
            </div>
            {taken?.options ? (
              <div key={`${index}-${choice.chosen}`} className="reveal grid gap-1.5 sm:grid-cols-2">
                <div>
                  <span className="mb-1 block text-[11px] text-stone-400">Which {taken.label.toLowerCase()}</span>
                  <OptionPicker
                    value={taken.items[0]?.name ?? ""}
                    onChange={(name) => onPick(index, name)}
                    className={inputClass}
                    groups={[
                      {
                        label: null,
                        options: taken.options.map((name) => ({
                          id: name,
                          name,
                          meta: "",
                          reference: { kind: "items" as const, slug: contentSlug(name), name },
                        })),
                      },
                    ]}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {kit.toolLines.map((entry) => (
        <p key={entry.line} className="flex flex-wrap items-center gap-1 text-xs text-stone-300">
          <span className="text-stone-500">{entry.line}:</span>
          {entry.item ? (
            <>
              <span className="text-amber-200">{entry.item}</span>
              <InfoButton
                label={entry.item}
                reference={{ kind: "items", slug: contentSlug(entry.item), name: entry.item }}
              />
              <span className="text-stone-500">from your tool proficiency</span>
            </>
          ) : (
            <span className="text-amber-300">the tool you pick on the Calling step.</span>
          )}
        </p>
      ))}
    </div>
  );
}
